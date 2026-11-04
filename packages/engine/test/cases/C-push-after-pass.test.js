// C-push-after-pass (plan/cases/work-item.md): an item waiting to merge after a PASS on head A returns to
// verifying for B when GitHub reports a push making the head B.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, done, path, pushed, run, starts, toVerifying, verdict } from '../flow.js';

const passedOnA = [...toVerifying(A), done('verify', verdict('PASS', A))];

test('C-push-after-pass: a push to B in awaitingMerge returns the item to verifying, for B', () => {
  const waiting = run(passedOnA);
  assert.equal(waiting.value, 'awaitingMerge');
  const after = run([...passedOnA, pushed(B)]);
  assert.equal(after.value, 'verifying');
  assert.equal(after.context.pr.headSha, B);
  assert.deepEqual(starts(waiting, pushed(B)), ['verify']);
});

test('C-push-after-pass: the old PASS for A can no longer reach merging, even if approved', () => {
  const states = path([...passedOnA, pushed(B), done('verify', verdict('PASS', A)), done('ask', { choice: 'approve', by: 'p' })]);
  assert.ok(!states.includes('merging'), states.join(' > '));
});

test('C-push-after-pass: a new PASS for B waits to merge again, and an approval merges at B', () => {
  const merged = run([...passedOnA, pushed(B), done('verify', verdict('PASS', B)), done('ask', { choice: 'approve', by: 'p' })]);
  assert.equal(merged.value, 'merging');
  assert.equal(merged.context.verdict.sha, B);
});
