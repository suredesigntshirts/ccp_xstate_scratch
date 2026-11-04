// The observe page's data layer (plan item obs-page, Expect `answers`): for real sessions it gives tokens by agent,
// time by kind, refusals with their rule and what was asked of the person, each matching the derived views; and the
// published page runs this same code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, validate } from '../../../../../packages/journal/src/index.js';
import { time } from '../../../../../packages/journal/src/derive/time.js';
import { attention } from '../../../../../packages/journal/src/derive/attention.js';
import { asks, inScope, observe, parseJournal, refreshRow, refusals, scopes, tokensByAgent } from '../data.js';
import { OUT, build, releaseOf } from '../build.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/rows.jsonl', import.meta.url));
const { rows } = readFile(FIXTURE);
const HEADLESS = '059f9a1c-69c2-4a98-8ef9-c842c0561883';
const THREAD = 'cmsg_01VhYV3jhQ9s4qrrh2th12sN8VmmfRj9W1iKvVYBXDUDjc';
const THREAD_SESSION = 'session_01KfkB5HZRbfGRGcZb4ar2mX';
const PROBE = 'eb589e54-f6d0-57f5-b6b3-2ec2ba0f8921';

test('the fixture is 26 schema-valid rows of three real sessions', () => {
  assert.equal(rows.length, 26);
  assert.deepEqual(readFile(FIXTURE).bad, []);
  assert.deepEqual(new Set(rows.map((r) => r.session)), new Set([HEADLESS, THREAD_SESSION, PROBE]));
});

test('tokens by agent: the main turn and the subagent, summed as the rows give them', () => {
  const t = observe(rows, { session: HEADLESS }).tokens;
  assert.deepEqual(t.agents.map((a) => [a.agent, a.type, a.total]), [[null, 'main', 88594], ['a60631230daf90ce7', 'general-purpose', 67590]]);
  assert.equal(t.total.total, 156184);
  // The same rows overhead.js counts: every turn.usage and agent.finish, all four token fields alike.
  const byHand = rows.filter((r) => r.session === HEADLESS && (r.kind === 'turn.usage' || r.kind === 'agent.finish'))
    .reduce((s, r) => s + r.payload.tokens.input + r.payload.tokens.output + r.payload.tokens.cacheRead + r.payload.tokens.cacheCreation, 0);
  assert.equal(t.total.total, byHand);
});

test('time by kind is the time view: working, each wait, rebuild and unknown, summing to the wall clock', () => {
  for (const scope of [{}, { session: HEADLESS }, { day: '2026-10-30' }, { thread: THREAD }]) {
    const got = observe(rows, scope).time;
    const { totals } = time(inScope(rows, scope));
    assert.deepEqual(got, { wallMs: totals.wallMs, workingMs: totals.workingMs, ...totals.waitingMs, unknownMs: totals.unknownMs });
    assert.equal(got.workingMs + got.person + got.ci + got.wake + got.rebuild + got.unknownMs, got.wallMs);
  }
  assert.deepEqual(observe(rows, { session: HEADLESS }).time, { wallMs: 13823, workingMs: 10602, person: 0, ci: 0, wake: 0, rebuild: 3221, unknownMs: 0 });
});

test('refusals come with their rule, source and what happened next', () => {
  const r = observe(rows).refusals;
  assert.equal(r.count, 1);
  assert.deepEqual(r.byRule, { '[Self-Modification]': 1 });
  assert.deepEqual({ ...r.list[0], id: undefined }, { id: undefined, at: '2026-10-30T11:34:29.900Z', session: PROBE, agent: null, source: 'classifier', rule: '[Self-Modification]', tool: 'Bash', then: 'not retried' });
  const id = r.list[0].id;
  const retried = [...rows, { id: 'x', at: '2026-10-30T11:35:00.000Z', session: PROBE, kind: 'tool.call', payload: { ok: true, retryOf: id } }];
  assert.equal(refusals(retried).list[0].then, 'retried, ran');
  const again = [...rows, { id: 'y', at: '2026-10-30T11:35:00.000Z', session: PROBE, kind: 'refusal', payload: { rule: '[Self-Modification]', retryOf: id } }];
  assert.equal(refusals(again).list.find((x) => x.id === id).then, 'refused again');
});

test('what was asked of the person matches the attention view: one card, tapped after 25 minutes, and one message', () => {
  const a = observe(rows, { thread: THREAD }).asks;
  assert.deepEqual({ messages: a.messages, taps: a.taps, cards: a.cards, posts: a.posts, open: a.open }, { messages: 1, taps: 1, cards: 1, posts: 0, open: 0 });
  assert.deepEqual(a.waits, { count: 1, totalMs: 1503000, maxMs: 1503000 });
  const view = attention(rows);
  assert.deepEqual(a.list, view.cards);
  assert.equal(a.messages, view.threads[THREAD].messages);
  assert.equal(a.cards, view.threads[THREAD].cards);
  assert.deepEqual(asks([]).list, []);
});

test('a scope keeps a day, a thread\'s sessions or one session, and lists what can be picked', () => {
  assert.deepEqual(scopes(rows), { days: ['2026-10-30'], threads: [THREAD], sessions: [THREAD_SESSION, PROBE, HEADLESS], items: [] });
  assert.equal(inScope(rows, { thread: THREAD }).length, 3);
  assert.ok(inScope(rows, { thread: THREAD }).every((r) => r.session === THREAD_SESSION));
  assert.equal(inScope(rows, { session: PROBE }).length, 1);
  assert.equal(inScope(rows, { day: '2026-10-29' }).length, 0);
  assert.equal(inScope([...rows, rows[0]]).length, 26, 'a row read twice counts once');
  assert.equal(tokensByAgent(inScope(rows, { thread: THREAD })).total.total, 0);
});

test('freshness gives the newest row time and the newest release that wrote rows', () => {
  const f = observe([...rows, { ...rows[0], id: 'later', at: '2026-10-31T09:00:00.000Z', release: '0.1.10' }]).freshness;
  assert.equal(f.newestAt, '2026-10-31T09:00:00.000Z');
  assert.equal(f.release, '0.1.10');
  assert.deepEqual(f.releases, ['0.1.10', '0.1.0']);
});

test('a journal file\'s text parses to rows, and torn lines are counted, not dropped silently', () => {
  const text = readFileSync(FIXTURE, 'utf8');
  const out = parseJournal(`${text}{"torn":\n\n{"id":1}\n`, 'f.jsonl');
  assert.equal(out.rows.length, 26);
  assert.deepEqual(out.bad.map((b) => [b.file, b.line]), [['f.jsonl', 27], ['f.jsonl', 29]]);
});

test('a page.refresh row is a valid journal row with its duration and row count', () => {
  const row = refreshRow({ id: 'r1', at: '2026-10-30T19:00:00.000Z', url: 'https://claude.ai/code/artifact/x', ms: 412, rows: 26, files: 3, bad: 0, newestAt: '2026-10-30T18:18:26.574Z', release: '0.1.9', scope: { day: '2026-10-30' }, viewer: null });
  assert.deepEqual(validate(row), []);
  assert.equal(row.kind, 'page.refresh');
  assert.deepEqual(row.source, { system: 'artifact', ref: 'https://claude.ai/code/artifact/x' });
  assert.deepEqual({ ms: row.payload.ms, rows: row.payload.rows }, { ms: 412, rows: 26 });
});

test('the built page is current with its sources, and its bundled script gives the same answers as the module', () => {
  const html = readFileSync(OUT, 'utf8');
  const release = releaseOf(html);
  assert.match(release, /^\d+\.\d+\.\d+$/);
  assert.equal(html, build(release), 'observe.html is stale: run node plugins/harness/pages/observe/build.mjs');
  const script = html.match(/<script>\n\/\/ Built by[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const window = {};
  new Function('window', script)(window);
  for (const scope of [{}, { thread: THREAD }, { session: HEADLESS }]) assert.deepEqual(window.ObserveData.observe(rows, scope), observe(rows, scope));
  assert.equal(window.ObserveData.PAGE_RELEASE, release);
});

test('the page reads only on load and on Refresh: no timers', () => {
  const page = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'page.html'), 'utf8');
  assert.doesNotMatch(page, /setInterval|requestAnimationFrame/);
  assert.equal([...page.matchAll(/setTimeout\(/g)].length, 1);
});
