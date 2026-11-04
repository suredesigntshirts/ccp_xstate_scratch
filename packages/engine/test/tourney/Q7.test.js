// Q7 merge outside the host: the PR is merged on GitHub by someone else; the item must not end as verified-done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWorld, quickFixToMerge, wake, closed, tap, openRun, offer, ISSUE, startEvent, briefReturns, builderReturns, deliver } from './world.js';

test('Q7: a merge on GitHub while the item waits for its tap sends it to replanning, and it ends dropped, never done', async () => {
  const w = await itemWorld();
  try {
    await quickFixToMerge(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    w.gh.mergeOutside(1);
    const [got] = await wake(w, closed('o/r#1'));
    assert.equal(got.outcome, 'applied');
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.equal(w.host.snapshot.context.failure.kind, 'merged-outside');
    assert.equal(w.host.snapshot.context.failure.pr, 'o/r#1');
    assert.deepEqual(openRun(w.host, 'ask').input.choices, ['replan', 'drop']);
    await tap(w, 1);
    assert.equal(w.host.snapshot.value, 'dropped');
    assert.equal(w.host.snapshot.context.merge, null);
    assert.deepEqual(w.gh.merges, [], 'the host never merged');
  } finally {
    await w.close();
  }
});

test('Q7: merged outside before verification (gated.verifying) also replans, and a done event the host never made is refused', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w);
    await builderReturns(w);
    await deliver(w);
    w.gh.mergeOutside(1);
    await wake(w, closed('o/r#1'));
    assert.equal(w.host.snapshot.value, 'replanning');
    // A merge done event with no merge run open is stale: only the host's own merge effect can make merge.head.
    const [forged] = await offer(w.host, [{ event: { type: 'xstate.done.actor.merge', output: { sha: 'd'.repeat(40), head: w.gh.headOf(1) } }, run: 'it-1:99.merge', source: { system: 'harness', ref: 'forged' } }], w.handlers);
    assert.equal(forged.outcome, 'stale');
    assert.notEqual(w.host.snapshot.value, 'done');
  } finally {
    await w.close();
  }
});
