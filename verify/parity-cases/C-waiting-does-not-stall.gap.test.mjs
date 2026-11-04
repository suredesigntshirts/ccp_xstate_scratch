// Verifier's characterisation of a GAP: C-waiting-does-not-stall is NOT met on the engine at the head (gaps.json, given
// to fix-waiting-wake). The case: given one item waiting on a person's card, then another independent item still
// advances, AND a wake is scheduled for the waiting one. The first half holds; the second does not: no wake is
// scheduled for an item waiting on a card. Asserted as today's behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE, fresh, offer, open, pending, start } from './lib.mjs';
import { agentActors, realHandlers, thread } from './gaps-lib.mjs';

test('GAP C-waiting-does-not-stall: another item advances, but no wake is scheduled for the one waiting on its card', async () => {
  const root = fresh();
  const plat = thread();
  const waiting = open(root, { item: 'it-wait' });
  await offer(waiting, [start()], realHandlers({ plat }));
  assert.equal(waiting.snapshot.value, 'awaitingMerge');
  assert.equal(plat.cards.length, 1, 'it is waiting on a person card');

  // The first half of the case holds: an independent item advances meanwhile.
  const other = open(root, { item: 'it-other' });
  await offer(other, [start('owner', { issue: { ...ISSUE, url: 'https://github.com/o/r/issues/8' } })], realHandlers({ plat }));
  assert.equal(other.snapshot.value, 'awaitingMerge');

  // The second half does not: nothing schedules a wake for the waiting item.
  assert.equal(pending(waiting).timers.length, 0, 'the waiting item has no timer');
  // The only wakes ever asked for are the build timeouts from before the PASS (the building state's delay); the state
  // that waits on the person asked for none, and the building timers are dropped when it is left.
  assert.deepEqual(plat.wakes.filter((w) => !/\.building$/.test(w.key)), [], 'no wake was asked for in the waiting state');
  assert.ok(plat.wakes.every((w) => /buildTimeout/.test(w.key)), plat.wakes.map((w) => w.key).join());
});

test('GAP C-waiting-does-not-stall (contrast): a state with a delay does ask the clock, so the scheduling machinery exists', async () => {
  const root = fresh();
  const plat = thread();
  const host = open(root);
  // build never returns: the building state's timeout asks for a wake
  await offer(host, [start()], realHandlers({ plat, actors: agentActors({ build: [] }) }));
  assert.equal(host.snapshot.value, 'building');
  assert.equal(plat.wakes.length, 1);
});
