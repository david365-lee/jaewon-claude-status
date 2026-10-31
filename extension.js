'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const usage = require('./lib/usage');

const t = vscode.l10n.t;
const SECTION = 'jaewonClaudeStatus';

/** Reads only the bytes appended since the last read, so large transcripts stay cheap to follow. */
class SessionTracker {
  constructor(file, log) {
    this.file = file;
    this.log = log;
    this.offset = 0;
    this.tail = '';
    this.state = usage.emptyState();
  }
  async update() {
    const stat = await fs.promises.stat(this.file);
    if (stat.size < this.offset) {
      this.log.info(`Transcript shrank, re-reading: ${this.file}`);
      this.offset = 0;
      this.tail = '';
      this.state = usage.emptyState();
    }
    if (stat.size === this.offset) return false;
    const handle = await fs.promises.open(this.file, 'r');
    try {
      const length = stat.size - this.offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, this.offset);
      this.offset = stat.size;
      const result = usage.applyText(this.state, this.tail + buffer.toString('utf8'), error =>
        this.log.warn(`Skipped an unreadable transcript line: ${error.message}`),
      );
      this.tail = result.tail;
      return result.changed;
    } finally {
      await handle.close();
    }
  }
}

function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

async function newestJsonl(dir) {
  let best;
  for (const name of await fs.promises.readdir(dir).catch(() => [])) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    const stat = await fs.promises.stat(file).catch(() => undefined);
    if (stat && (!best || stat.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: stat.mtimeMs };
  }
  return best;
}

/** The newest session of the open workspace; with scope "latest" (or no match) the newest of all projects. */
async function findSession(scope) {
  const projects = path.join(claudeHome(), 'projects');
  const dirs = await fs.promises.readdir(projects, { withFileTypes: true }).catch(() => []);
  const names = dirs.filter(d => d.isDirectory()).map(d => d.name);
  if (scope !== 'latest') {
    const wanted = new Set((vscode.workspace.workspaceFolders || []).map(f => usage.encodeProjectDir(f.uri.fsPath).toLowerCase()));
    let best;
    for (const name of names.filter(n => wanted.has(n.toLowerCase()))) {
      const found = await newestJsonl(path.join(projects, name));
      if (found && (!best || found.mtimeMs > best.mtimeMs)) best = found;
    }
    if (best) return { ...best, matched: 'workspace' };
  }
  let best;
  for (const name of names) {
    const found = await newestJsonl(path.join(projects, name));
    if (found && (!best || found.mtimeMs > best.mtimeMs)) best = found;
  }
  return best ? { ...best, matched: 'latest' } : undefined;
}

function config() {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: c.get('enabled', true),
    scope: c.get('sessionScope', 'workspace'),
    interval: Math.max(1, c.get('refreshIntervalSeconds', 5)),
    format: c.get('statusFormat', '$(pulse) {percent}% · {context}/{window}'),
    contextWindow: c.get('contextWindow', 'auto'),
    warnAt: c.get('warningThreshold', 70),
    errorAt: c.get('errorThreshold', 90),
    pricing: c.get('pricing', {}),
    alignment: c.get('alignment', 'right'),
  };
}

function snapshot(state, cfg) {
  const win = usage.contextWindow(state, cfg.contextWindow);
  const percent = usage.percentOf(state, win.size);
  const cost = usage.estimateCost(state, cfg.pricing);
  return {
    win,
    percent,
    cost,
    values: {
      percent: percent === undefined ? '—' : percent,
      context: usage.formatTokens(state.context),
      window: usage.formatTokens(win.size),
      model: state.model || '—',
      session: usage.formatTokens(usage.sessionTotal(state)),
      output: usage.formatTokens(state.totals.output),
      cost: cost === undefined ? '' : '≈$' + cost.toFixed(2),
    },
  };
}

function tooltip(state, session, cfg) {
  const s = snapshot(state, cfg);
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: [`${SECTION}.showDetails`, `${SECTION}.showLog`] };
  const row = (k, v) => `| ${k} | ${v} |\n`;
  md.appendMarkdown(`**$(pulse) ${t('Claude Code usage')}**\n\n| | |\n|---|---|\n`);
  md.appendMarkdown(row(t('Model'), s.values.model));
  md.appendMarkdown(row(t('Context'), `${s.values.context} / ${s.values.window} (${s.values.percent}%)` + (s.win.isAuto ? ` · ${t('window auto-detected')}` : '')));
  md.appendMarkdown(row(t('Session input'), usage.formatTokens(state.totals.input)));
  md.appendMarkdown(row(t('Session output'), usage.formatTokens(state.totals.output)));
  md.appendMarkdown(row(t('Cache read / write'), `${usage.formatTokens(state.totals.cacheRead)} / ${usage.formatTokens(state.totals.cacheWrite)}`));
  md.appendMarkdown(row(t('Responses'), String(state.responses)));
  if (s.cost !== undefined) md.appendMarkdown(row(t('Estimated cost'), `${s.values.cost} (${t('from your pricing settings')})`));
  md.appendMarkdown(row(t('Last response'), state.lastAt ? new Date(state.lastAt).toLocaleString() : '—'));
  md.appendMarkdown(row(t('Session'), session.matched === 'workspace' ? t('this workspace') : t('most recent of all projects')));
  md.appendMarkdown(`\n[${t('Details')}](command:${SECTION}.showDetails) · [${t('Log')}](command:${SECTION}.showLog)`);
  return md;
}

function activate(context) {
  const log = vscode.window.createOutputChannel('Jaewon Claude Status', { log: true });
  let cfg = config();
  let item;
  let tracker;
  let session;
  let timer;
  let busy = false;

  const createItem = () => {
    item?.dispose();
    item = vscode.window.createStatusBarItem(
      `${SECTION}.status`,
      cfg.alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
      100,
    );
    item.name = 'Jaewon Claude Status';
    item.command = `${SECTION}.showDetails`;
    context.subscriptions.push(item);
  };

  const render = () => {
    if (!cfg.enabled) return item.hide();
    if (!tracker || tracker.state.responses === 0) {
      item.text = `$(pulse) ${t('Claude: no session')}`;
      item.tooltip = t('No Claude Code transcript with usage was found yet. Start a conversation in Claude Code.');
      item.backgroundColor = undefined;
      return item.show();
    }
    const s = snapshot(tracker.state, cfg);
    item.text = usage.renderFormat(cfg.format, s.values).replace(/\s+·\s*$/, '');
    item.tooltip = tooltip(tracker.state, session, cfg);
    const level = usage.severity(s.percent, cfg.warnAt, cfg.errorAt);
    item.backgroundColor = level === 'none' ? undefined : new vscode.ThemeColor(`statusBarItem.${level}Background`);
    item.show();
  };

  const refresh = async () => {
    if (busy || !cfg.enabled) return;
    busy = true;
    try {
      const found = await findSession(cfg.scope);
      if (!found) {
        tracker = undefined;
        session = undefined;
      } else if (!tracker || tracker.file !== found.file) {
        log.info(`Following session ${path.basename(found.file)} (${found.matched})`);
        tracker = new SessionTracker(found.file, log);
        session = found;
      }
      if (tracker) await tracker.update();
      render();
    } catch (error) {
      log.error(`Refresh failed: ${error.message}`);
    } finally {
      busy = false;
    }
  };

  const restart = () => {
    clearInterval(timer);
    timer = setInterval(refresh, cfg.interval * 1000);
    void refresh();
  };

  const showDetails = async () => {
    if (!tracker) {
      vscode.window.showInformationMessage(t('No Claude Code transcript with usage was found yet. Start a conversation in Claude Code.'));
      return;
    }
    const st = tracker.state;
    const s = snapshot(st, cfg);
    const lines = [
      { label: `$(symbol-class) ${t('Model')}`, description: s.values.model },
      { label: `$(pulse) ${t('Context')}`, description: `${s.values.context} / ${s.values.window} (${s.values.percent}%)` },
      { label: `$(arrow-down) ${t('Session input')}`, description: usage.formatTokens(st.totals.input) },
      { label: `$(arrow-up) ${t('Session output')}`, description: usage.formatTokens(st.totals.output) },
      { label: `$(database) ${t('Cache read / write')}`, description: `${usage.formatTokens(st.totals.cacheRead)} / ${usage.formatTokens(st.totals.cacheWrite)}` },
      { label: `$(comment-discussion) ${t('Responses')}`, description: String(st.responses) },
    ];
    if (s.cost !== undefined) lines.push({ label: `$(credit-card) ${t('Estimated cost')}`, description: s.values.cost });
    const copy = { label: `$(copy) ${t('Copy summary')}`, action: 'copy' };
    const openLog = { label: `$(output) ${t('Show log')}`, action: 'log' };
    const settings = { label: `$(gear) ${t('Open settings')}`, action: 'settings' };
    const pick = await vscode.window.showQuickPick(
      [...lines, { label: '', kind: vscode.QuickPickItemKind.Separator }, copy, openLog, settings],
      { title: t('Claude Code usage'), placeHolder: path.basename(tracker.file) },
    );
    if (pick?.action === 'copy') {
      await vscode.env.clipboard.writeText(lines.map(l => `${l.label.replace(/^\$\([^)]+\)\s*/, '')}: ${l.description}`).join('\n'));
      vscode.window.showInformationMessage(t('Usage summary copied.'));
    } else if (pick?.action === 'log') log.show();
    else if (pick?.action === 'settings') vscode.commands.executeCommand('workbench.action.openSettings', SECTION);
  };

  createItem();
  context.subscriptions.push(
    log,
    vscode.commands.registerCommand(`${SECTION}.showDetails`, showDetails),
    vscode.commands.registerCommand(`${SECTION}.refresh`, () => {
      tracker = undefined;
      log.info('Manual refresh');
      return refresh();
    }),
    vscode.commands.registerCommand(`${SECTION}.showLog`, () => log.show()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(SECTION)) return;
      const alignmentChanged = config().alignment !== cfg.alignment;
      cfg = config();
      log.info('Settings changed');
      if (alignmentChanged) createItem();
      tracker = undefined;
      restart();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      tracker = undefined;
      void refresh();
    }),
    { dispose: () => clearInterval(timer) },
  );
  log.info(`Activated. Reading transcripts from ${path.join(claudeHome(), 'projects')}`);
  restart();
}

function deactivate() {}

module.exports = { activate, deactivate };
