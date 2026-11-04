// Replay: a journal of inputs, as #110's host wrote them ({ seq, event, hash }), steps the workflow by pure
// transitions to the same snapshot, and a hash that no longer matches is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialTransition, transition } from 'xstate';
import { hashOf, replay } from '../src/index.js';
import { A, ISSUE, done, machine, pr, toVerifying, verdict, workflow } from './flow.js';

const events = [...toVerifying(A), done('verify', verdict('PASS', A)), done('ask', { choice: 'approve', by: 'p' }), done('merge', { sha: A })];
const journal = () => {
  let [snapshot] = initialTransition(machine, { issue: ISSUE });
  const entries = [{ seq: 0, event: { type: 'xstate.init', input: { issue: ISSUE } }, hash: hashOf(snapshot) }];
  events.forEach((event, i) => {
    [snapshot] = transition(machine, snapshot, event);
    entries.push({ seq: i + 1, event, hash: hashOf(snapshot) });
  });
  return entries;
};

test('a journal replays to the state and output it recorded', () => {
  const end = replay(workflow, journal());
  assert.equal(end.value, 'done');
  assert.equal(end.output.merge.sha, A);
});

test('a journal entry whose hash no longer matches is refused, naming the entry', () => {
  const entries = journal();
  entries[2] = { ...entries[2], event: done('build', pr('c'.repeat(40))) };
  assert.throws(() => replay(workflow, entries), /journal entry 2 replays to \w+, not \w+/);
});
