// Verifier tests for obs-page `live` (no network, no Playwright). Fixtures: a copy of the project's real journal taken
// at verification time plus one row the verifier appended (session verifier-obs-page), the builder's rich fixture
// rows as fixture-rich.jsonl, the output of test/browser-check.mjs against them (a stand-in for claude.ai's files/db,
// not a real viewer), and the published page read back with the Artifact tool. The counting below does NOT import
// data.js; only the time view (packages/journal) is called for wall-clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { time } from '../../packages/journal/src/derive/time.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p) => join(here, 'fixtures', p);
const sessionsDir = fx('pf/harness/journal/sessions');
const load = (skip = []) => readdirSync(sessionsDir).filter((n) => n.endsWith('.jsonl') && !skip.includes(n))
  .flatMap((n) => readFileSync(join(sessionsDir, n), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const fmtMs = (ms) => { if (!ms) return '0s'; const s = Math.round(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`; };
const files = (skip) => readdirSync(sessionsDir).filter((n) => n.endsWith('.jsonl') && !skip.includes(n)).length;
const n = (x) => x.toLocaleString('en-US');
const json = (p) => JSON.parse(readFileSync(fx(p), 'utf8'));

// My own counts, straight from the rows.
const mine = (rows) => {
  const uniq = [...new Map(rows.map((r) => [r.id, r])).values()];
  let tokens = 0;
  for (const r of uniq) if (r.kind === 'turn.usage' || r.kind === 'agent.finish') for (const f of ['input', 'output', 'cacheRead', 'cacheCreation']) tokens += r.payload?.tokens?.[f] ?? 0;
  return {
    rows: uniq.length,
    newest: uniq.map((r) => r.at).sort().at(-1),
    tokens,
    refusals: uniq.filter((r) => r.kind === 'refusal').length,
    cards: new Set(uniq.filter((r) => r.kind === 'card.posted').map((r) => r.payload.cardId ?? r.id)).size,
    wall: fmtMs(time(uniq).totals.wallMs),
  };
};

test('the copied journal holds the verifier row, and it is the newest row', () => {
  const rows = load(['fixture-rich.jsonl']);
  const m = mine(rows);
  const row = rows.find((r) => r.session === 'verifier-obs-page');
  assert.ok(row && row.kind === 'tool.call' && row.v === 1);
  assert.equal(m.newest, row.at);
});

test('real journal copy: the page showed my counts (rows, wall clock, tokens, refusals, cards), release and newest row time', () => {
  const m = mine(load(['fixture-rich.jsonl']));
  const { shown, refreshes, errors } = json('browser-check.json');
  assert.deepEqual(errors, []);
  assert.equal(shown['read'].startsWith(`${m.rows} rows in ${files(['fixture-rich.jsonl'])} files`), true, shown.read);
  assert.equal(shown['time-wall'], m.wall);
  assert.equal(shown['tokens-total'], `${n(m.tokens)} tokens`);
  assert.equal(shown['refusals-count'], `${m.refusals} refused`);
  assert.match(shown['asks-cards'], new RegExp(`^${m.cards} cards?,`));
  assert.equal(shown['newest'], m.newest.replace('T', ' ').slice(0, 19));
  assert.equal(shown['page-release'], '0.1.9');
  assert.equal(shown['release'], '0.1.9');
  assert.equal(refreshes.length, 2); // one read on load, one on pressing Refresh
  for (const r of refreshes) {
    assert.equal(r.kind, 'page.refresh');
    assert.equal(r.payload.rows, m.rows);
    assert.equal(r.payload.newestAt, m.newest);
    assert.equal(typeof r.payload.ms, 'number');
    assert.equal(r.release, '0.1.9');
  }
});

test('journal with the builder rich fixture added: tokens, refusals, cards and wall clock match my hand counts', () => {
  const m = mine(load());
  const { shown, refreshes } = json('browser-check-rich.json');
  assert.equal(m.tokens, 156184);
  assert.equal(shown['tokens-total'], `${n(m.tokens)} tokens`);
  assert.equal(shown['refusals-count'], `${m.refusals} refused`);
  assert.equal(m.refusals, 1);
  assert.equal(shown['asks-cards'].split(',')[0], `${m.cards} card`);
  assert.equal(shown['time-wall'], m.wall);
  assert.equal(shown['read'].startsWith(`${m.rows} rows in ${files([])} files`), true);
  assert.equal(refreshes.at(-1).payload.rows, m.rows);
});

test('the published page contains the built file byte for byte and declares the same bundled release', () => {
  const pub = readFileSync(fx('published-index.html'), 'utf8');
  const built = readFileSync(join(here, '../../plugins/harness/pages/observe/observe.html'), 'utf8');
  assert.ok(pub.includes(built.trim()));
  assert.match(pub, /PAGE_RELEASE = "0\.1\.16"/);
});
