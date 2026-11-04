// Q2 push after PASS: the head moves after the verdict; no merge until the new head is verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputsOfWake } from '../../src/wake.js';
import { makeWorld, ISSUE, BRIEFS, builds, verifies, tapWake, suiteWake, pending } from './world.js';

async function toAwaitingMerge(w) {
  await w.start('q2', 'quick-fix', { issue: ISSUE });
  assert.ok((await w.agent('q2', 'brief', () => BRIEFS)).accepted);
  await w.drive('q2');
  assert.ok((await w.agent('q2', 'build', builds(w, 1))).accepted);
  await w.drive('q2');
  assert.equal(w.host('q2').snapshot.value, 'verifying', 'CI green seen at accept');
  assert.ok((await w.agent('q2', 'verify', verifies(w, 'PASS'))).accepted);
  await w.drive('q2');
  assert.equal(w.host('q2').snapshot.value, 'awaitingMerge');
  return w.gh.state[1].head;
}

test('Q2: a push after PASS sends the item back to verify the new head; the old card and an old-head verdict count for nothing', async () => {
  const w = await makeWorld();
  try {
    const A = await toAwaitingMerge(w);
    const oldCard = w.cardOf('q2');
    const B = w.commit(w.repo, 'pushed after the verdict');
    w.gh.push(1, B);
    w.gh.green(B);
    await w.drive('q2', suiteWake(B, 1));
    const h = w.host('q2');
    assert.equal(h.snapshot.value, 'verifying');
    assert.equal(h.snapshot.context.pr.at, B);
    assert.equal(h.snapshot.context.verdict, null);
    assert.equal(w.openRun('q2', 'verify').input.target.at, B, 'the new verify run is for B');
    assert.deepEqual(inputsOfWake(h, tapWake(oldCard, 0), { now: '2999-01-01T00:00:00Z' }), [], 'the old card matches no run');
    await w.drive('q2', tapWake(oldCard, 0));
    assert.deepEqual(w.gh.merges, []);
    // A verifier that reports A (the old head) is refused: GitHub shows B.
    const stale = await w.agent('q2', 'verify', async ({ input, worktree }) => {
      w.checkout(worktree, A);
      return { result: 'PASS', pr: { url: input.target.url, at: A }, issue: input.issue, report: 'r' };
    }, 'ag-stale');
    assert.equal(stale.refused?.rule, 'ref');
    assert.match(stale.refused.reason, new RegExp(`GitHub shows .* at ${B}, not ${A}`));
    // The true verdict on B: accepted, and only then the merge, at B.
    const r = await w.agent('q2', 'verify', verifies(w, 'PASS'), 'ag-stale');
    assert.ok(r.accepted, JSON.stringify(r));
    await w.drive('q2');
    assert.equal(w.host('q2').snapshot.value, 'awaitingMerge');
    await w.drive('q2', tapWake(w.cardOf('q2'), 0));
    assert.equal(w.host('q2').snapshot.value, 'done');
    assert.deepEqual(w.gh.merges, [{ number: 1, sha: B, base: 'main' }]);
  } finally {
    await w.close();
  }
});

test('Q2 variant: approve tapped after the push but before CI reports the new head: GitHub refuses the merge at A; no merge', async () => {
  const w = await makeWorld();
  try {
    const A = await toAwaitingMerge(w);
    const B = w.commit(w.repo, 'pushed after the verdict');
    w.gh.push(1, B);
    await w.drive('q2', tapWake(w.cardOf('q2'), 0));
    assert.equal(w.host('q2').snapshot.value, 'replanning');
    assert.deepEqual(w.gh.merges, [{ number: 1, sha: A, base: 'main' }], 'the one merge call named A');
    assert.equal(w.gh.state[1].merged, false, 'GitHub refused it: nothing merged');
    assert.match(w.host('q2').snapshot.context.failure, /refused the merge/);
  } finally {
    await w.close();
  }
});

// Round 2: `reenter` is gone. A head that moves while the verify run is open goes to the twin state reverifying,
// which starts a fresh verify run; a second move goes back to verifying. The old run is stopped each time.
test('Q2 (round 2, no reenter): the head moves twice while verifying; each move stops the open verify run and starts one for the new head', async () => {
  const w = await makeWorld();
  try {
    await w.start('q2v', 'quick-fix', { issue: ISSUE });
    assert.ok((await w.agent('q2v', 'brief', () => BRIEFS)).accepted);
    await w.drive('q2v');
    assert.ok((await w.agent('q2v', 'build', builds(w, 1))).accepted);
    await w.drive('q2v');
    const A = w.gh.state[1].head;
    const run1 = w.openRun('q2v', 'verify');
    assert.equal(run1.input.target.at, A);

    const B = w.commit(w.repo, 'pushed while verifying');
    w.gh.push(1, B); w.gh.green(B);
    await w.drive('q2v', suiteWake(B, 1));
    let h = w.host('q2v');
    assert.equal(h.snapshot.value, 'reverifying');
    assert.equal(h.snapshot.context.pr.at, B);
    const run2 = w.openRun('q2v', 'verify');
    assert.notEqual(run2.id, run1.id, 'a fresh verify run');
    assert.equal(run2.input.target.at, B);
    // The world has no stop handler (no agent to kill), so each stop effect the host emits stays pending, by run.
    const stops = () => pending(w.host('q2v')).effects.filter((e) => e.type === 'stop').map((e) => e.run);
    assert.ok(stops().includes(run1.id), 'the verify run for A was stopped');

    const C = w.commit(w.repo, 'pushed again while verifying');
    w.gh.push(1, C); w.gh.green(C);
    await w.drive('q2v', suiteWake(C, 1));
    h = w.host('q2v');
    assert.equal(h.snapshot.value, 'verifying', 'the twin alternates back');
    const run3 = w.openRun('q2v', 'verify');
    assert.equal(run3.input.target.at, C);
    assert.ok(stops().includes(run2.id), 'the verify run for B was stopped');

    // The PASS on C counts, and the merge is at C.
    assert.ok((await w.agent('q2v', 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('q2v');
    assert.equal(w.host('q2v').snapshot.value, 'awaitingMerge');
    assert.equal(w.host('q2v').snapshot.context.verdict.pr.at, C);
    await w.drive('q2v', tapWake(w.cardOf('q2v'), 0));
    assert.equal(w.host('q2v').snapshot.value, 'done');
    assert.deepEqual(w.gh.merges, [{ number: 1, sha: C, base: 'main' }]);
  } finally {
    await w.close();
  }
});
