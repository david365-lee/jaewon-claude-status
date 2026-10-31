'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const u = require('../lib/usage');

const line = (id, usage, extra = {}) =>
  JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-11-01T00:00:00Z', message: { id, model: 'claude-opus-5-5', usage }, ...extra });
const use = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });

test('project folders are encoded the way Claude Code names them', () => {
  assert.equal(u.encodeProjectDir('d:\\소스코드\\persona'), 'd-------persona');
  assert.equal(u.encodeProjectDir('/home/me/my.app'), '-home-me-my-app');
});

test('context is the latest main-thread input including cache; streamed duplicates count once', () => {
  const s = u.emptyState();
  u.applyText(s, [line('m1', use(10, 5, 1000, 200)), line('m1', use(10, 50, 1000, 200)), line('m2', use(2, 7, 1300, 100))].join('\n') + '\n');
  assert.equal(s.context, 2 + 1300 + 100);
  assert.equal(s.responses, 2);
  assert.deepEqual(s.totals, { input: 12, output: 57, cacheRead: 2300, cacheWrite: 300 });
});

test('subagent (sidechain) responses add to totals but never replace the main context', () => {
  const s = u.emptyState();
  u.applyText(s, line('m1', use(1, 1, 5000)) + '\n' + line('a1', use(1, 1, 90000), { isSidechain: true }) + '\n');
  assert.equal(s.context, 5001);
  assert.equal(s.totals.cacheRead, 95000);
});

test('partial lines are kept for the next read and broken lines are reported, not fatal', () => {
  const s = u.emptyState();
  const errors = [];
  const full = line('m1', use(1, 2, 3, 4));
  const first = u.applyText(s, '{bad json}\n' + full.slice(0, 20), e => errors.push(e));
  assert.equal(errors.length, 1);
  assert.equal(s.responses, 0);
  u.applyText(s, first.tail + full.slice(20) + '\n');
  assert.equal(s.responses, 1);
});

test('synthetic and non-usage entries are ignored', () => {
  const s = u.emptyState();
  const synthetic = JSON.stringify({ type: 'assistant', message: { id: 'x', model: '<synthetic>', usage: use(0, 0) } });
  u.applyText(s, synthetic + '\n' + JSON.stringify({ type: 'user', message: {} }) + '\n');
  assert.equal(s.responses, 0);
  assert.equal(s.context, undefined);
});

test('context window: explicit setting wins; auto picks 1M only with evidence', () => {
  const s = u.emptyState();
  u.applyText(s, line('m1', use(1, 1, 150000)) + '\n');
  assert.deepEqual(u.contextWindow(s, 'auto'), { size: 200000, isAuto: true });
  assert.deepEqual(u.contextWindow(s, 400000), { size: 400000, isAuto: false });
  u.applyText(s, line('m2', use(1, 1, 518387, 1635)) + '\n');
  assert.equal(u.contextWindow(s, 'auto').size, 1000000);
  const big = u.emptyState();
  u.applyText(big, line('m1', use(1, 1, 10), { requestedModel: 'claude-opus-5-5[1m]' }) + '\n');
  assert.equal(u.contextWindow(big, 'auto').size, 1000000);
  assert.equal(u.percentOf(s, 1000000), 52);
});

test('cost is shown only from configured prices, longest prefix first', () => {
  const s = u.emptyState();
  u.applyText(s, line('m1', use(1e6, 1e6, 1e6, 1e6)) + '\n');
  assert.equal(u.estimateCost(s, {}), undefined);
  assert.equal(u.estimateCost(s, { 'claude-sonnet': { input: 1 } }), undefined);
  assert.equal(u.estimateCost(s, { claude: { input: 100 }, 'claude-opus': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 3 } }), 6.5);
});

test('formatting, placeholders and thresholds', () => {
  assert.equal(u.formatTokens(999), '999');
  assert.equal(u.formatTokens(84321), '84k');
  assert.equal(u.formatTokens(1000000), '1M');
  assert.equal(u.formatTokens(1500000), '1.5M');
  assert.equal(u.formatTokens(undefined), '—');
  assert.equal(u.renderFormat('{percent}% {nope}', { percent: 5 }), '5% {nope}');
  assert.equal(u.severity(69, 70, 90), 'none');
  assert.equal(u.severity(70, 70, 90), 'warning');
  assert.equal(u.severity(95, 70, 90), 'error');
});

test('every UI string has ko, ja and zh-cn translations, and every nls key exists in all languages', () => {
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
  const used = new Set([...src.matchAll(/\bt\('([^']+)'\)/g)].map(m => m[1]));
  for (const lang of ['ko', 'ja', 'zh-cn']) {
    const bundle = JSON.parse(fs.readFileSync(path.join(root, `l10n/bundle.l10n.${lang}.json`), 'utf8'));
    for (const key of used) assert.ok(bundle[key], `${lang}: ${key}`);
  }
  const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const keys = [...pkg.matchAll(/"%([^%]+)%"/g)].map(m => m[1]);
  for (const file of ['package.nls.json', 'package.nls.ko.json', 'package.nls.ja.json', 'package.nls.zh-cn.json']) {
    const nls = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const k of keys) assert.ok(nls[k], `${file}: ${k}`);
  }
});

test('the real transcript format on this machine parses without errors (when present)', () => {
  const dir = path.join(require('os').homedir(), '.claude', 'projects');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
    .flatMap(d => fs.readdirSync(path.join(dir, d.name)).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, d.name, f)));
  if (!files.length) return;
  const s = u.emptyState();
  const text = fs.readFileSync(files[0], 'utf8');
  let errors = 0;
  u.applyText(s, text.endsWith('\n') ? text : text + '\n', () => errors++);
  assert.equal(errors, 0);
});
