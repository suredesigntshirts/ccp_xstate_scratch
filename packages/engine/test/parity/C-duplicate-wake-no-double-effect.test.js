// C-duplicate-wake-no-double-effect (plan/cases/work-item.md): the same GitHub event delivered twice, or a host
// restart mid-effect, makes the merge, post or spawn happen once. GitHub is a local server that counts merges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, cardOf, checkWake, effectRows, fakeGitHub, inputsOfWakeFor, offer, open, openRun, tapWake, toAwaitingMerge, world, merge } from './world.js';

test('C-duplicate-wake-no-double-effect: the same red check wake twice, and again to a fresh host, starts one build', async () => {
  const { root, host, effects, agents } = await toAwaitingMerge({ head: A });
  const wake = checkWake({ head: A });
  const results = await offer(host, [...inputsOfWakeFor(host, wake), ...inputsOfWakeFor(host, wake)], effects);
  assert.deepEqual(results.map((r) => r.outcome), ['applied', 'duplicate']);
  const again = open(root);
  const [late] = await offer(again, inputsOfWakeFor(again, wake), effects);
  assert.equal(late.outcome, 'duplicate');
  assert.equal(agents.started.filter((e) => e.actor === 'build').length, 2, 'the first build and one rebuild');
});

test('C-duplicate-wake-no-double-effect: the same tap delivered twice merges once', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { host, effects } = await toAwaitingMerge({ head: A, gh });
    const tap = tapWake(cardOf(host, openRun(host, 'ask')));
    const first = await offer(host, inputsOfWakeFor(host, tap), effects);
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(inputsOfWakeFor(host, tap), [], 'the ask is no longer open');
    assert.ok(first.length >= 1);
    assert.equal(gh.merges.length, 1);
  } finally {
    await gh.close();
  }
});

test('C-duplicate-wake-no-double-effect: a host that stopped mid-merge looks the merge up on GitHub instead of merging again', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { root, host, agents } = await toAwaitingMerge({ head: A, gh });
    const real = merge({ github: gh.client });
    // The merge reaches GitHub, then the host process dies before the effect ends.
    let reached;
    const reachedGitHub = new Promise((ok) => (reached = ok));
    const dying = { merge: { start: async (effect) => { await real.start(effect); reached(); return new Promise(() => {}); } } };
    offer(host, inputsOfWakeFor(host, tapWake(cardOf(host, openRun(host, 'ask')))), world({ gh, actors: { ...agents.byActor, ...dying } }));
    await reachedGitHub;
    assert.equal(gh.merges.length, 1);
    assert.deepEqual(effectRows(root).filter((r) => r.payload.actor === 'merge').map((r) => r.payload.phase), ['start']);

    // A new host on the next wake finds the open effect and asks GitHub, which says it merged.
    const after = open(root);
    assert.equal(after.snapshot.value, 'merging');
    await offer(after, [], world({ gh, actors: agents.byActor }));
    assert.equal(after.snapshot.value, 'done');
    assert.equal(gh.merges.length, 1, 'no second merge');
    assert.deepEqual(effectRows(root).filter((r) => r.payload.actor === 'merge').map((r) => r.payload.phase), ['start', 'done']);
  } finally {
    await gh.close();
  }
});
