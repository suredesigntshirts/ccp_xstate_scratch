// Q1 happy path: issue -> brief -> build -> verify PASS -> CI green -> person approves -> merged at the verified head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, agents, fakeGitHub, fresh, loadWorkflow, offer, open, platform, prOf, start, statesOf, suite, tap, world } from './world-b.js';

const spec = loadWorkflow('quick-fix');
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
const BRIEFS = { builder: 'change math.js', verifier: 'check math.js exports multiply' };

async function run({ ciFirst = false } = {}) {
  const gh = await fakeGitHub({ 1: { head: A } });
  const plat = platform();
  const root = fresh('q1');
  const host = open(root, spec);
  const a = agents({ brief: [BRIEFS], build: [{ pr: prOf(1, A) }], verify: ciFirst ? [null] : [{ result: 'PASS', sha: A, ciChanged: false, report: 'ok' }] });
  const fx = world({ gh, plat, actors: a.byActor });
  await offer(host, [start({ issue: ISSUE })], fx);
  return { gh, plat, root, host, a, fx };
}

test('Q1: issue to merge at the verified, CI-green head on one person tap', async () => {
  const { gh, plat, root, host, fx } = await run();
  try {
    assert.equal(host.snapshot.value, 'waitingCi');
    assert.equal(plat.cards.length, 0, 'no card before CI is green');
    await offer(host, suite(host, A), fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');
    assert.equal(gh.merges.length, 0, 'no merge before the person approves');
    await offer(host, tap(host, 0), fx); // "approve"
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);
    assert.equal(host.snapshot.context.merge.sha, gh.state[1].mergeSha);
    assert.deepEqual(statesOf(root), ['briefing', 'building', 'verifying', 'waitingCi', 'awaitingMerge', 'merging', 'done']);
    assert.equal(plat.cards.length, 1, 'one card on the happy path');
    assert.deepEqual(plat.cards[0].choices, ['approve', 'reject']);
  } finally {
    await gh.close();
  }
});

test('Q1 variant: CI green before the verdict also reaches awaitingMerge (order-free join)', async () => {
  const { gh, host, a, fx } = await run({ ciFirst: true });
  try {
    assert.equal(host.snapshot.value, 'verifying');
    await offer(host, suite(host, A), fx);
    assert.equal(host.snapshot.value, 'verifying', 'green CI is recorded, the item stays');
    assert.equal(host.snapshot.context.ci.sha, A);
    const verify = a.started.find((e) => e.actor === 'verify');
    await offer(host, [{ event: { type: 'xstate.done.actor.verify', output: { result: 'PASS', sha: A, ciChanged: false, report: 'ok' } }, run: verify.id, source: { system: 'harness', ref: 'v' } }], fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');
  } finally {
    await gh.close();
  }
});
