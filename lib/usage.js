'use strict';
// Pure helpers: no VS Code or file-system access, so they can be unit-tested with node:test.

const DEFAULT_WINDOW = 200000;
const LARGE_WINDOW = 1000000;

/** Claude Code stores transcripts under ~/.claude/projects/<cwd with every non-alphanumeric char replaced by '-'>. */
function encodeProjectDir(folderPath) {
  return String(folderPath).replace(/[^A-Za-z0-9]/g, '-');
}

function emptyState() {
  return {
    sessionId: undefined,
    model: undefined,
    lastAt: undefined,
    context: undefined, // input + cache write + cache read of the latest main-thread response
    isLargeContext: false,
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    responses: 0,
    seen: new Map(), // message id -> counted usage, so streamed duplicates of one response count once
  };
}

const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** Applies one transcript line (already JSON-parsed) to the state. Returns true when the state changed. */
function applyEntry(state, entry) {
  if (!entry || entry.type !== 'assistant' || !entry.message || !entry.message.usage) return false;
  const msg = entry.message;
  if (msg.model === '<synthetic>') return false;
  const u = msg.usage;
  const usage = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
  };
  const id = msg.id || entry.requestId || entry.uuid;
  const previous = id ? state.seen.get(id) : undefined;
  for (const k of Object.keys(state.totals)) state.totals[k] += usage[k] - (previous ? previous[k] : 0);
  if (id) {
    if (!previous) state.responses += 1;
    state.seen.set(id, usage);
  } else {
    state.responses += 1;
  }
  if (entry.sessionId) state.sessionId = entry.sessionId;
  if (!entry.isSidechain) {
    state.context = usage.input + usage.cacheRead + usage.cacheWrite;
    state.model = msg.model || state.model;
    state.lastAt = entry.timestamp || state.lastAt;
    const requested = String(entry.requestedModel || '') + ' ' + String(msg.model || '');
    state.isLargeContext = /\[1m\]|-1m\b/i.test(requested);
  }
  return true;
}

/** Feeds raw text (possibly ending mid-line) and returns the unfinished tail to keep for the next read. */
function applyText(state, text, onError) {
  const lines = text.split(/\r?\n/);
  const tail = lines.pop();
  let changed = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      changed = applyEntry(state, JSON.parse(line)) || changed;
    } catch (error) {
      if (onError) onError(error, line);
    }
  }
  return { tail, changed };
}

/**
 * Context window: an explicit number from settings wins. "auto" uses 1M when the model id says so
 * or the context already exceeds 200k (it could not fit otherwise), else 200k.
 */
function contextWindow(state, setting) {
  const fixed = Number(setting);
  if (Number.isFinite(fixed) && fixed > 0) return { size: fixed, isAuto: false };
  const large = state.isLargeContext || num(state.context) > DEFAULT_WINDOW;
  return { size: large ? LARGE_WINDOW : DEFAULT_WINDOW, isAuto: true };
}

function percentOf(state, window) {
  if (state.context === undefined || !window) return undefined;
  return Math.min(100, Math.round((state.context / window) * 100));
}

function formatTokens(n) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function sessionTotal(state) {
  const t = state.totals;
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

/**
 * Estimated cost from prices the user configured (USD per million tokens), matched by model-id prefix.
 * Returns undefined when no price applies: nothing is guessed.
 */
function estimateCost(state, pricing) {
  if (!pricing || !state.model) return undefined;
  const key = Object.keys(pricing)
    .filter(k => state.model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return undefined;
  const p = pricing[key] || {};
  const t = state.totals;
  const part = (tokens, price) => (Number.isFinite(Number(price)) ? (tokens / 1e6) * Number(price) : 0);
  return part(t.input, p.input) + part(t.output, p.output) + part(t.cacheRead, p.cacheRead) + part(t.cacheWrite, p.cacheWrite);
}

/** Fills {placeholders} in the user's status format. Unknown placeholders are left as written. */
function renderFormat(format, values) {
  return String(format).replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined ? m : String(values[k])));
}

function severity(percent, warnAt, errorAt) {
  if (percent === undefined) return 'none';
  if (percent >= errorAt) return 'error';
  if (percent >= warnAt) return 'warning';
  return 'none';
}

module.exports = {
  DEFAULT_WINDOW,
  LARGE_WINDOW,
  encodeProjectDir,
  emptyState,
  applyEntry,
  applyText,
  contextWindow,
  percentOf,
  formatTokens,
  sessionTotal,
  estimateCost,
  renderFormat,
  severity,
};
