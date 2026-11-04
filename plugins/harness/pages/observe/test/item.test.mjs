// The item view (plan item engine-item-views): an item's state, handles, rounds, tokens and person asks, from every
// journal file. The journal here is built by hand in the shapes the engine and capture write: the driver session
// applies the item's events, its agents finish in the driver's file (one agent twice, cumulatively, as the first real
// run's brief agent did), and the card is posted and tapped in another session, the thread that owns the item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemView, items, inScope, observe, tokensByAgent } from '../data.js';

const ITEM = 'it-1';
const DRIVER = 'driver-session';
const THREAD_SESSION = 'thread-session';
const CARD = 'cmsg_card1';
const PR = 'https://github.com/o/r/pull/1';
const A = 'a'.repeat(40);
let n = 0;
const row = (at, kind, extra = {}) => ({ v: 1, id: `r${n++}`, at: `2026-10-31T03:${at}.000Z`, kind, session: DRIVER, agent: null, item: null, state: null, release: '0.1.16', source: { system: 'test', ref: String(n) }, payload: {}, ...extra });
const tokens = (total) => ({ input: 0, output: 0, cacheRead: total, cacheCreation: 0 });
const transition = (at, seq, state, event, run = null) => row(at, 'engine.transition', { item: ITEM, state: JSON.stringify(state), payload: { transition: `${ITEM}#${seq}`, seq, outcome: 'applied', workflow: 'quick-fix', event, run } });

const journal = [
  transition('00:00', 0, 'briefing', { type: 'xstate.init', input: { issue: { url: 'https://github.com/o/r/issues/7' } } }),
  row('00:05', 'agent.spawn', { item: ITEM, state: '"briefing"', agent: 'ag-brief', payload: { agentId: 'ag-brief', run: `${ITEM}:0.brief` } }),
  // The brief agent's SubagentStop fired twice; each row covers the whole transcript.
  row('00:30', 'agent.finish', { agent: 'ag-brief', payload: { agentId: 'ag-brief', tokens: tokens(1000) } }),
  row('00:35', 'agent.finish', { agent: 'ag-brief', payload: { agentId: 'ag-brief', tokens: tokens(1200) } }),
  transition('00:36', 1, 'building', { type: 'xstate.done.actor.brief', output: { builder: 'b', verifier: 'v' } }, `${ITEM}:0.brief`),
  row('00:40', 'agent.spawn', { item: ITEM, state: '"building"', agent: 'ag-build', payload: { agentId: 'ag-build', run: `${ITEM}:1.build` } }),
  row('01:00', 'tool.call', { agent: 'ag-build', item: ITEM, state: '"building"', payload: { tool: 'Bash', ok: true } }),
  row('01:30', 'agent.finish', { agent: 'ag-build', payload: { agentId: 'ag-build', tokens: tokens(5000) } }),
  transition('01:31', 2, 'verifying', { type: 'xstate.done.actor.build', output: { pr: { branch: 'b', headSha: A, url: PR } } }, `${ITEM}:1.build`),
  transition('02:00', 3, 'awaitingMerge', { type: 'xstate.done.actor.verify', output: { result: 'PASS', sha: A, report: 'r' } }, `${ITEM}:2.verify`),
  row('02:00', 'turn.usage', { payload: { tokens: tokens(300) } }),
  // The card effect finishes with the card's id once the thread records it (bin/host.js card).
  row('02:10', 'engine.effect', { item: ITEM, state: '"awaitingMerge"', payload: { effect: `${ITEM}:3.ask`, type: 'run', phase: 'start', actor: 'ask', outcome: null } }),
  row('02:10', 'engine.effect', { item: ITEM, state: '"awaitingMerge"', payload: { effect: `${ITEM}:3.ask`, type: 'run', phase: 'done', actor: 'ask', outcome: { ref: CARD } } }),
  // In the thread's session: the card went up at 02:05 and the person tapped it at 12:05, ten minutes later.
  row('02:05', 'card.posted', { session: THREAD_SESSION, payload: { cardId: CARD, thread: 'cmsg_thread', card: 'Merge this PR at the verified commit?' } }),
  row('12:05', 'person.tap', { session: THREAD_SESSION, payload: { cardId: CARD, thread: 'cmsg_thread', option: 'approve', optionIndex: 0, sentAt: '2026-10-31T03:12:05.000Z' } }),
  row('12:06', 'turn.usage', { session: THREAD_SESSION, payload: { tokens: tokens(999) } }),
  transition('12:07', 4, 'merging', { type: 'xstate.done.actor.ask', output: { choice: 'approve', by: 'person' } }, `${ITEM}:3.ask`),
  transition('12:09', 5, 'done', { type: 'xstate.done.actor.merge', output: { sha: 'd'.repeat(40) } }, `${ITEM}:4.merge`),
  row('13:00', 'agent.finish', { agent: 'someone-else', payload: { agentId: 'someone-else', tokens: tokens(77777) } }),
];

test('finish-once: an agent with two cumulative agent.finish rows counts its last row, here and in tokensByAgent', () => {
  const v = itemView(journal, ITEM);
  assert.equal(v.tokens.agents.total, 1200 + 5000, 'not 1000 + 1200 + 5000');
  assert.equal(v.tokens.sessions.total, 300, 'the driver\'s turns; the thread session drove no transition');
  assert.equal(v.tokens.total.total, 6500);
  const brief = tokensByAgent(journal).agents.find((a) => a.agent === 'ag-brief');
  assert.equal(brief.total, 1200);
});

test('spans-sessions: the item\'s card wait is joined from the thread session\'s card and tap rows by the card id', () => {
  const v = itemView(journal, ITEM);
  assert.equal(v.asks.length, 1);
  const [ask] = v.asks;
  assert.deepEqual([ask.cardId, ask.thread, ask.postedAt, ask.answeredAt, ask.choice, ask.open], [CARD, 'cmsg_thread', '2026-10-31T03:02:05.000Z', '2026-10-31T03:12:07.000Z', 'approve', false]);
  assert.equal(v.personWaitMs, 10 * 60 * 1000 + 2000, 'from the card going up in the thread to the answer reaching the item');
});

test('the item view gives workflow, state, handles and rounds; an open card waits until now', () => {
  const v = itemView(journal, ITEM);
  assert.deepEqual([v.workflow, v.state, v.transitions, v.rounds], ['quick-fix', 'done', 6, 1]);
  assert.deepEqual(v.handles, { issue: 'https://github.com/o/r/issues/7', pr: { url: PR, headSha: A }, verdict: { result: 'PASS', sha: A }, merge: { sha: 'd'.repeat(40) } });
  const open = itemView(journal.slice(0, 14), ITEM, { now: '2026-10-31T03:05:05.000Z' });
  assert.equal(open.state, 'awaitingMerge');
  assert.deepEqual([open.asks[0].open, open.asks[0].waitMs], [true, 3 * 60 * 1000]);
  assert.equal(itemView(journal, 'nope'), null);
});

test('an item is a scope: its rows, its agents\' rows and its driving sessions\' main rows', () => {
  assert.deepEqual(items(journal), [ITEM]);
  const scoped = inScope(journal, { item: ITEM });
  assert.ok(scoped.some((r) => r.kind === 'agent.finish' && r.agent === 'ag-build'));
  assert.ok(!scoped.some((r) => r.agent === 'someone-else'));
  assert.ok(!scoped.some((r) => r.session === THREAD_SESSION));
  assert.equal(observe(journal, { item: ITEM }).item.state, 'done');
  assert.equal(observe(journal, {}).item, null);
});
