// Q2 push after PASS: the head moves after the verdict; no merge until the new head is verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWorld, quickFixToMerge, wake, synchronize, pushFromOutside, openRun, cardOf, tapWake, inputsOfWakeFor, builderReturns, verifierReturns, deliver, checkSuite, tap, transitionsOf } from './world.js';

test('Q2: a push to B after the PASS on A takes the item back to building; the merge waits for B to be attested and verified', async () => {
  const w = await itemWorld();
  try {
    const A = await quickFixToMerge(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    const ask = openRun(w.host, 'ask');
    const oldCard = cardOf(w.host, ask);

    // The push the build already attested: nothing moves. (The design calls it "consumed"; the targetless, actionless
    // first candidate makes XState's can() false, so the host journals it as refused. Either way the state stays.)
    const [same] = await wake(w, synchronize(A));
    console.log('# synchronize at the attested head:', same.outcome, same.row.payload.reason);
    assert.ok(['applied', 'refused'].includes(same.outcome));
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });

    // Someone pushes B onto the PR's branch: GitHub's synchronize at an unattested head.
    const B = pushFromOutside(w.g, 'ccp/it-1/1', 'math.js', 'export const multiply = () => 0;\n');
    assert.equal(w.gh.headOf(1), B);
    const [moved] = await wake(w, synchronize(B));
    assert.equal(moved.outcome, 'applied');
    assert.equal(w.host.snapshot.value, 'building');
    assert.deepEqual(w.host.snapshot.context.failure, { kind: 'moved', head: B });
    assert.equal(openRun(w.host, 'ask'), null, 'the ask run was stopped');
    assert.ok([...w.host.effects.values()].some((e) => e.effect.type === 'stop' && e.effect.run === ask.id));
    assert.deepEqual(inputsOfWakeFor(w.host, tapWake(oldCard, 0)), [], 'a tap on the old card offers nothing');
    assert.equal(w.gh.merges.length, 0);

    // The current attempt's builder re-attests the PR at B (no new commit), the verifier PASSes B, CI is green on B.
    const b = await builderReturns(w, { files: {} });
    assert.ok(b.got.accepted, JSON.stringify(b.got));
    assert.equal(b.head, B);
    await deliver(w);
    assert.equal(openRun(w.host, 'verify').input.subject, B);
    await verifierReturns(w);
    await deliver(w);
    await wake(w, checkSuite(B));
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    assert.equal(w.gh.merges.length, 0);
    await tap(w, 0);
    assert.equal(w.host.snapshot.value, 'done');
    assert.deepEqual(w.gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: B }]);
    assert.equal(w.host.snapshot.context.verdict.attested.subject, B);
    assert.ok(transitionsOf(w.root).some((r) => r.payload.event.type === 'github.pull_request.synchronize' && r.payload.outcome === 'applied'));
  } finally {
    await w.close();
  }
});
