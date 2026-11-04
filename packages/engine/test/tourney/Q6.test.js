// Q6 late push from a dead attempt: after a failure-driven replan, attempt 1's builder pushes; it must not affect
// attempt 2's gates or merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, C, agents, fakeGitHub, fresh, lateDone, loadWorkflow, offer, open, platform, prOf, push, red, start, suite, tap, world, written } from './world-b.js';

const spec = loadWorkflow('quick-fix');
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
const V = (result, sha) => ({ result, sha, ciChanged: false, report: 'r' });

test('Q6: after a replan, attempt 1\'s late return, push and checks change nothing; attempt 2 merges at its own head', async () => {
  const gh = await fakeGitHub({ 1: { head: A }, 2: { head: B } });
  try {
    const plat = platform();
    const host = open(fresh('q6'), spec);
    const a = agents({
      brief: [{ builder: 'b', verifier: 'v' }, { builder: 'b2', verifier: 'v2' }],
      build: [{ pr: prOf(1, A) }, { pr: prOf(1, A) }, { pr: prOf(2, B, 'build/y') }],
      verify: [V('FAIL', A), V('FAIL', A), V('PASS', B)]
    });
    const fx = world({ gh, plat, actors: a.byActor });
    await offer(host, [start({ issue: ISSUE })], fx);
    assert.equal(host.snapshot.value, 'replanning', 'two FAILs: replanning');
    const attempt1Build = a.started.find((e) => e.actor === 'build');

    await offer(host, written(host, { choice: 'replan', why: 'five whys: the brief missed the export' }), fx);
    assert.equal(host.snapshot.context.attempt, 2);
    assert.equal(host.snapshot.value, 'waitingCi');
    assert.equal(host.snapshot.context.pr.url, prOf(2, B).url);
    await offer(host, suite(host, B), fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');
    const before = JSON.stringify(host.snapshot.context);

    // Attempt 1's builder: a late return on its closed run, a push to its PR, and CI on that push.
    gh.push(1, C);
    const late = await offer(host, lateDone(attempt1Build.id, 'build', { pr: prOf(1, C) }), fx);
    assert.equal(late[0].outcome, 'stale');
    const [pushed] = await offer(host, push(host, A, C), fx);
    assert.equal(pushed.outcome, 'refused');
    const [green] = await offer(host, suite(host, C), fx);
    assert.equal(green.outcome, 'refused');
    const [redC] = await offer(host, red(host, C), fx);
    assert.equal(redC.outcome, 'refused');
    assert.equal(host.snapshot.value, 'awaitingMerge');
    assert.equal(JSON.stringify(host.snapshot.context), before, 'attempt 2\'s context is untouched');

    await offer(host, tap(host, 0), fx);
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 2, sha: B }]);
  } finally {
    await gh.close();
  }
});
