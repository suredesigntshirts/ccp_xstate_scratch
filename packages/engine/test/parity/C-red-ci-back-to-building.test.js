// C-red-ci-back-to-building (plan/cases/work-item.md): an item whose PR's CI goes red can't reach merging, and returns
// to building with the failing check as input. The red result is a check_run.completed wake shaped as the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, cardOf, checkWake, fakeGitHub, inputsOfWakeFor, offer, openRun, tapWake, toAwaitingMerge } from './world.js';

test('C-red-ci-back-to-building: a red check on the head while waiting to merge sends the item to building with the check, and the approval merges nothing', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { host, effects, agents } = await toAwaitingMerge({ head: A, gh });
    const card = cardOf(host, openRun(host, 'ask'));
    const inputs = inputsOfWakeFor(host, checkWake({ head: A }));
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].source.system, 'github');
    const [result] = await offer(host, inputs, effects);
    assert.equal(result.outcome, 'applied');
    assert.equal(host.snapshot.value, 'building');
    const rebuild = agents.started.filter((e) => e.actor === 'build').at(-1);
    assert.deepEqual([rebuild.input.failure.check, rebuild.input.failure.conclusion, rebuild.input.failure.sha], ['test', 'failure', A]);
    assert.match(rebuild.input.failure.url, /actions\/runs/);
    // The person approves the old card afterwards: no ask is open, so nothing is offered and nothing merges.
    assert.deepEqual(inputsOfWakeFor(host, tapWake(card)), []);
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});

test('C-red-ci-back-to-building: a green check, or a red one on another head, changes nothing (the control)', async () => {
  const { host, effects } = await toAwaitingMerge({ head: A });
  await offer(host, inputsOfWakeFor(host, checkWake({ head: A, conclusion: 'success' })), effects);
  await offer(host, inputsOfWakeFor(host, checkWake({ head: 'c'.repeat(40) })), effects);
  assert.equal(host.snapshot.value, 'awaitingMerge');
});
