// C-push-after-pass (plan/cases/work-item.md): an item waiting to merge after a PASS on head A returns to verifying
// for B when GitHub reports a push making the head B. Driven through the host, with GitHub a local server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, offer, inputsOfWakeFor, openRun, cardOf, tapWake, toAwaitingMerge, fakeGitHub, verdict, transitions } from './world.js';

const pushed = (head) => ({ event: { type: 'pr.pushed', headSha: head }, source: { system: 'github', ref: `push ${head}` } });

test('C-push-after-pass: a push to B while waiting to merge returns the item to verifying for B, and the merge is at B', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { root, host, effects, agents } = await toAwaitingMerge({ head: A, gh });
    assert.equal(host.snapshot.value, 'awaitingMerge');
    const oldCard = cardOf(host, openRun(host, 'ask'));

    gh.push(1, B);
    const [moved] = await offer(host, [pushed(B)], effects);
    assert.equal(moved.outcome, 'applied');
    assert.equal(host.snapshot.value, 'verifying');
    assert.equal(host.snapshot.context.pr.headSha, B);
    const verify = agents.started.filter((e) => e.actor === 'verify').at(-1);
    assert.equal(verify.input.pr.headSha, B, 'the new verify run is for B');

    // The approval on the card asked about A offers nothing: that ask is no longer open.
    assert.deepEqual(inputsOfWakeFor(host, tapWake(oldCard)), []);
    assert.equal(gh.merges.length, 0);

    // The verifier's PASS for B, then the person's approval on the new card, merges at B.
    const verifyRun = openRun(host, 'verify');
    await offer(host, [{ event: { type: 'xstate.done.actor.verify', output: verdict('PASS', B) }, run: verifyRun.id, source: { system: 'harness', ref: 'return v2' } }], effects);
    assert.equal(host.snapshot.value, 'awaitingMerge');
    const newCard = cardOf(host, openRun(host, 'ask'));
    assert.notEqual(newCard, oldCard);
    await offer(host, inputsOfWakeFor(host, tapWake(newCard)), effects);
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges, [{ number: 1, sha: B }]);
    assert.ok(transitions(root).some((r) => r.payload.event.type === 'pr.pushed' && r.payload.outcome === 'applied'));
  } finally {
    await gh.close();
  }
});
