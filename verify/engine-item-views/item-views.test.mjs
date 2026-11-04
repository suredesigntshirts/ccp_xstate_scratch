// Verifier tests for plan item engine-item-views: finish-once and spans-sessions, written by the verifier.
// The journal is the first real run's own rows (fixtures/first-real-run.jsonl: item fri-jsonl-lint's engine.transition,
// engine.effect and agent.spawn rows from its item file, and its session's agent.finish and turn.usage rows, copied
// from /mnt/project-files/first-real-issue/harness/journal). Numbers are checked by hand against the real rows:
//   brief agent a2ebf0564500db56e finish 1 = 6 + 2733 + 46748 + 26972 = 76,459; finish 2 = 10 + 3104 + 73720 + 27450 = 104,284
//   build agent  a996384a3603a9ec6 = 18 + 5464 + 210944 + 22046 = 238,472
//   verify agent a3ecae1c7e91c5be0 = 10 + 3692 + 119018 + 22445 = 145,165
//   driver turn.usage              = 19 + 2018 + 312953 + 30948 = 345,938
//   item = 104,284 + 238,472 + 145,165 + 345,938 = 833,859 (retro-first-item.md); summing both brief rows adds 76,459.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemView, tokensByAgent, inScope } from '../../plugins/harness/pages/observe/data.js';
import { overhead } from '../../packages/journal/src/derive/overhead.js';

const here = dirname(fileURLToPath(import.meta.url));
const real = readFileSync(join(here, 'fixtures', 'first-real-run.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ITEM = 'fri-jsonl-lint';
const DRIVER = 'b61aac02-d158-42c9-bc6a-e013c1448ee0';
const BRIEF = 'a2ebf0564500db56e';

test('fixture is the real run: the brief agent has two cumulative finish rows', () => {
  const f = real.filter((r) => r.kind === 'agent.finish' && r.agent === BRIEF);
  assert.deepEqual(f.map((r) => Object.values(r.payload.tokens).reduce((a, b) => a + b, 0)), [76459, 104284]);
});

test('finish-once: item view counts the brief agent once, at its last row: 833,859 as the retro counted by hand', () => {
  const v = itemView(real, ITEM);
  assert.equal(v.tokens.agents.total, 104284 + 238472 + 145165);
  assert.equal(v.tokens.sessions.total, 345938);
  assert.equal(v.tokens.total.total, 833859);
  assert.equal(v.tokens.total.total - (104284 + 238472 + 145165 + 345938), 0);
  assert.deepEqual([v.tokens.total.input, v.tokens.total.output, v.tokens.total.cacheRead, v.tokens.total.cacheCreation], [57, 14278, 716635, 102889]);
  assert.equal(v.tokens.agentCount, 3);
  assert.equal(v.tokens.finished, 3, 'four finish rows, three agents');
});

test('finish-once: row order does not matter (the later row by time wins, not the later in the file)', () => {
  const v = itemView([...real].reverse(), ITEM);
  assert.equal(v.tokens.total.total, 833859);
});

test('finish-once: tokensByAgent and the overhead view count the brief agent once too', () => {
  const brief = tokensByAgent(real).agents.find((a) => a.agent === BRIEF);
  assert.equal(brief.total, 104284);
  assert.equal(brief.rows, 1);
  const o = overhead(real, [], { harness: [] });
  assert.equal(o.unattributed, 833859, 'no PRs: all of the session\'s tokens, each agent once');
  assert.equal(o.sessions[DRIVER].tokens, 833859);
});

test('finish-once: a second agent that finished twice in another session is counted once per session and agent', () => {
  // Same agent id in two sessions are two agents (the key is session + agent), so this must not collapse them.
  const copy = real.filter((r) => r.kind === 'agent.finish' && r.agent === BRIEF).map((r, i) => ({ ...r, id: `x${i}`, session: 'other-session' }));
  const t = tokensByAgent([...real, ...copy]).agents.filter((a) => a.agent === BRIEF);
  assert.deepEqual(t.map((a) => a.total), [104284, 104284]);
});

// spans-sessions: the item's ask run, then the card and the tap in the thread's session, a third file.
const THREAD = 'thread-session-0001';
const CARD = 'cmsg_verifier_card';
const mk = (id, at, kind, extra) => ({ v: 1, id, at, kind, session: DRIVER, agent: null, item: null, state: null, release: '0.1.16', source: { system: 'test', ref: id }, payload: {}, ...extra });
const ask = [
  mk('e1', '2026-10-31T02:47:35.000Z', 'engine.effect', { item: ITEM, state: '"awaitingMerge"', payload: { effect: `${ITEM}:3.ask`, type: 'run', phase: 'start', actor: 'ask', outcome: null } }),
  mk('e2', '2026-10-31T02:47:55.000Z', 'engine.effect', { item: ITEM, state: '"awaitingMerge"', payload: { effect: `${ITEM}:3.ask`, type: 'run', phase: 'done', actor: 'ask', outcome: { ref: CARD } } }),
  mk('c1', '2026-10-31T02:47:53.000Z', 'card.posted', { session: THREAD, payload: { cardId: CARD, thread: 'cmsg_t', card: 'Merge?' } }),
  mk('p1', '2026-10-31T03:03:53.000Z', 'person.tap', { session: THREAD, payload: { cardId: CARD, thread: 'cmsg_t', option: 'approve', optionIndex: 0 } }),
  mk('t1', '2026-10-31T03:04:00.000Z', 'engine.transition', { item: ITEM, state: '"merging"', payload: { transition: `${ITEM}#4`, seq: 4, outcome: 'applied', workflow: 'quick-fix', run: `${ITEM}:3.ask`, event: { type: 'xstate.done.actor.ask', output: { choice: 'approve', by: 'person' } } } }),
];

test('spans-sessions: card.posted and person.tap in the thread\'s file give the item the 16 min 7 s wait and the card', () => {
  const v = itemView([...real, ...ask], ITEM);
  assert.equal(v.asks.length, 1);
  const [a] = v.asks;
  assert.equal(a.cardId, CARD);
  assert.equal(a.thread, 'cmsg_t');
  assert.equal(a.postedAt, '2026-10-31T02:47:53.000Z');
  assert.equal(a.answeredAt, '2026-10-31T03:04:00.000Z');
  assert.equal(a.open, false);
  // 02:47:53 -> 03:04:00 = 16 min 7 s = 967 s, by hand
  assert.equal(a.waitMs, 967000);
  assert.equal(v.personWaitMs, 967000);
  assert.equal(v.state, 'merging');
  assert.equal(v.tokens.total.total, 833859, 'the thread session\'s rows add no tokens (no turn.usage there)');
});

test('spans-sessions: without the thread\'s file the card is unknown (wait counts from the effect row naming it, 2 s later), so the join is what supplies it', () => {
  const v = itemView([...real, ...ask.filter((r) => r.session !== THREAD)], ITEM);
  assert.equal(v.asks[0].thread, null);
  assert.equal(v.asks[0].postedAt, '2026-10-31T02:47:55.000Z');
  assert.equal(v.personWaitMs, 965000, '02:47:55 -> 03:04:00 by hand; the joined card gives 967000');
});

test('spans-sessions: an open card waits until now, and another item\'s card with another id is not joined', () => {
  const noTap = ask.filter((r) => r.kind !== 'person.tap' && r.kind !== 'engine.transition');
  const other = [mk('c2', '2026-10-31T02:00:00.000Z', 'card.posted', { session: THREAD, payload: { cardId: 'cmsg_other', thread: 'cmsg_t2' } })];
  const v = itemView([...real, ...noTap, ...other], ITEM, { now: '2026-10-31T02:50:53.000Z' });
  assert.equal(v.asks[0].open, true);
  assert.equal(v.asks[0].waitMs, 3 * 60 * 1000);
  assert.equal(v.asks[0].thread, 'cmsg_t');
});

test('spans-sessions: the item scope does not pull in the thread session\'s rows, but itemView still joins them', () => {
  const rows = [...real, ...ask];
  assert.ok(!inScope(rows, { item: ITEM }).some((r) => r.session === THREAD));
  assert.equal(itemView(rows, ITEM).asks[0].thread, 'cmsg_t');
});
