// C-verdict-on-old-head (plan/cases/work-item.md): a PASS for commit A, when the PR's head is commit B, can't
// reach merging, and the verdict is recorded as stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, done, path, pushed, run, toVerifying, verdict } from '../flow.js';

test('C-verdict-on-old-head: a PASS for A while the head is B goes to replanning, not awaitingMerge or merging', () => {
  const events = [...toVerifying(B), done('verify', verdict('PASS', A))];
  const states = path(events);
  assert.equal(states.at(-1), 'replanning');
  assert.ok(!states.includes('awaitingMerge') && !states.includes('merging'), states.join(' > '));
});

test('C-verdict-on-old-head: the stale verdict is recorded beside the head it does not match', () => {
  const { context } = run([...toVerifying(B), done('verify', verdict('PASS', A))]);
  assert.deepEqual([context.verdict.result, context.verdict.sha, context.pr.headSha], ['PASS', A, B]);
});

test('C-verdict-on-old-head: a push to B during verifying, then the PASS for A, goes to replanning', () => {
  const states = path([...toVerifying(A), pushed(B), done('verify', verdict('PASS', A))]);
  assert.deepEqual(states.slice(-2), ['verifying', 'replanning']);
});

test('C-verdict-on-old-head: the same PASS at the head goes to awaitingMerge (the control)', () => {
  assert.equal(run([...toVerifying(B), done('verify', verdict('PASS', B))]).value, 'awaitingMerge');
});
