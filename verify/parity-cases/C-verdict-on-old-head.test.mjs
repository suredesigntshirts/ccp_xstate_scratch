// Verifier's own test, from the case text alone: C-verdict-on-old-head. A PASS verdict for commit A, when the PR's head
// is commit B, can't reach merging, and the verdict is recorded as stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, BRIEFS, PR, VERDICT, fresh, handlersFor, offer, open, rowsOf, start } from './lib.mjs';

test('PASS for A while the PR head is B never reaches awaitingMerge or merging; the verdict is kept as the stale one', async () => {
  const root = fresh();
  const host = open(root);
  const h = handlersFor({ brief: [BRIEFS], build: [PR(B)], verify: [VERDICT('PASS', A)] });
  await offer(host, [start()], h.handlers);
  assert.notEqual(host.snapshot.value, 'awaitingMerge');
  assert.notEqual(host.snapshot.value, 'merging');
  assert.equal(host.snapshot.value, 'replanning');
  assert.equal(host.snapshot.context.verdict.sha, A);
  assert.equal(host.snapshot.context.pr.headSha, B);
  const visited = rowsOf(root).filter((r) => r.kind === 'engine.transition').map((r) => r.state);
  assert.ok(!visited.some((s) => /awaitingMerge|merging/.test(s)), visited.join(' > '));
  assert.equal(h.count('merge'), 0);
});

test('the control: PASS for the head does wait to merge', async () => {
  const root = fresh();
  const host = open(root);
  const h = handlersFor({ brief: [BRIEFS], build: [PR(B)], verify: [VERDICT('PASS', B)] });
  await offer(host, [start()], h.handlers);
  assert.equal(host.snapshot.value, 'awaitingMerge');
});

test('a PASS verdict for A cannot be carried over a push: after a push to B, A\'s verdict does not merge', async () => {
  const root = fresh();
  const host = open(root);
  const h = handlersFor({ brief: [BRIEFS], build: [PR(A)], verify: [VERDICT('PASS', A)] });
  await offer(host, [start()], h.handlers);
  assert.equal(host.snapshot.value, 'awaitingMerge');
  await offer(host, [{ event: { type: 'pr.pushed', headSha: B }, source: { system: 'github', ref: 'p1' } }], h.handlers);
  assert.equal(host.snapshot.value, 'verifying');
  assert.equal(h.count('merge'), 0);
});
