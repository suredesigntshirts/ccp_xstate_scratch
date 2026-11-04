// Q2 push after PASS: the head moves after the verdict; no merge until the new head is verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, agents, cardOf, fakeGitHub, fresh, loadWorkflow, offer, open, openRun, platform, prOf, push, start, suite, tap, tapWake, world, NOW } from './world-b.js';
import { inputsOfWake } from '../../src/index.js';

const spec = loadWorkflow('quick-fix');
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };

test('Q2: a push to B after PASS at A returns to verifying for B; nothing merges until B is verified and approved', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const plat = platform();
    const host = open(fresh('q2'), spec);
    const a = agents({ brief: [{ builder: 'b', verifier: 'v' }], build: [{ pr: prOf(1, A) }], verify: [{ result: 'PASS', sha: A, ciChanged: false, report: 'ok' }, null] });
    const fx = world({ gh, plat, actors: a.byActor });
    await offer(host, [start({ issue: ISSUE })], fx);
    await offer(host, suite(host, A), fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');
    const oldCard = cardOf(host, openRun(host, 'ask'));

    gh.push(1, B);
    const [moved] = await offer(host, push(host, A, B), fx);
    assert.equal(moved.outcome, 'applied');
    assert.equal(host.snapshot.value, 'verifying');
    assert.equal(host.snapshot.context.pr.headSha, B);
    assert.equal(host.snapshot.context.ci, null, 'the old green is cleared');
    const verify = a.started.filter((e) => e.actor === 'verify').at(-1);
    assert.equal(verify.input.headSha, B, 'the new verify run is for B');
    assert.deepEqual(inputsOfWake(host, tapWake(oldCard), { now: NOW }), [], 'a tap on the old card offers nothing');
    assert.equal(gh.merges.length, 0);

    // A replayed push from A again (stale before) does not move anything.
    const [again] = await offer(host, push(host, A, B).map((i) => ({ ...i, source: { ...i.source, ref: 'other' } })), fx);
    assert.equal(again.outcome, 'refused');

    await offer(host, [{ event: { type: 'xstate.done.actor.verify', output: { result: 'PASS', sha: B, ciChanged: false, report: 'ok' } }, run: verify.id, source: { system: 'harness', ref: 'v2' } }], fx);
    assert.equal(host.snapshot.value, 'waitingCi', 'PASS at B waits for CI at B');
    const [oldGreen] = await offer(host, suite(host, A, 2), fx); // a re-run suite on A
    assert.equal(oldGreen.outcome, 'refused', 'green CI on A does not count for B');
    assert.equal(host.snapshot.value, 'waitingCi');
    await offer(host, suite(host, B), fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');
    assert.equal(gh.merges.length, 0);
    await offer(host, tap(host, 0), fx);
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: B }], 'merged at B only');
  } finally {
    await gh.close();
  }
});
