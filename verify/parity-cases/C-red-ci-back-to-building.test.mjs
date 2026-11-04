// Verifier's own test, from the case text alone: C-red-ci-back-to-building. An item whose PR's CI goes red can't
// reach merging, and returns to building with the failing check as input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, checkWake, inputsOfWake, offer, toAwaitingMerge, askRun } from './lib.mjs';

test('a red check on the head sends awaitingMerge back to building, with the check in the build input, and approving the old card merges nothing', async () => {
  const w = await toAwaitingMerge();
  const oldAsk = askRun(w.host);
  await offer(w.host, inputsOfWake(w.host, checkWake({ head: A, conclusion: 'failure', check: 'test' })), w.handlers);
  assert.equal(w.host.snapshot.value, 'building');
  const rebuild = w.log.filter((e) => e.actor === 'build').at(-1);
  assert.equal(w.count('build'), 2);
  assert.equal(rebuild.input.failure.check, 'test');
  assert.equal(rebuild.input.failure.conclusion, 'failure');
  assert.equal(rebuild.input.failure.sha, A);
  // the old approval card finds no open run
  const late = await offer(w.host, [{ event: { type: 'xstate.done.actor.ask', output: { choice: 'approve', by: 'person' } }, run: oldAsk.id, source: { system: 'hearth', ref: 'card-1' } }], w.handlers);
  assert.notEqual(late[0].outcome, 'applied');
  assert.equal(w.count('merge'), 0);
  assert.equal(w.host.snapshot.value, 'building');
});

test('green checks, and red ones on another head, change nothing', async () => {
  const w = await toAwaitingMerge();
  await offer(w.host, inputsOfWake(w.host, checkWake({ head: A, conclusion: 'success' })), w.handlers);
  await offer(w.host, inputsOfWake(w.host, checkWake({ head: B, conclusion: 'failure' })), w.handlers);
  assert.equal(w.host.snapshot.value, 'awaitingMerge');
  assert.equal(w.count('build'), 1);
});

test('a red check while verifying also returns to building, and it cannot reach merging', async () => {
  const { handlersFor, fresh, open, start, BRIEFS, PR } = await import('./lib.mjs');
  const root = fresh();
  const host = open(root);
  const h = handlersFor({ brief: [BRIEFS], build: [PR(A)] }); // verify stays open
  await offer(host, [start()], h.handlers);
  assert.equal(host.snapshot.value, 'verifying');
  await offer(host, inputsOfWake(host, checkWake({ head: A })), h.handlers);
  assert.equal(host.snapshot.value, 'building');
});
