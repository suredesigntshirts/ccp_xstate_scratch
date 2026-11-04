// Q3 Red CI: a required check fails on the head; with a build left the item rebuilds carrying the failing check as a
// typed failure; with none left it goes to replanning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, toJudging, agentReturns, wake, openRun, buildBranch, prUrl } from './world.js';

test('Q3: red required check on the head rebuilds with a typed failure, then with no build left replans', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const { host, effects } = hostFor({ root, repo, gh, plat });
    const A = repo.commit('A');
    const B = repo.commit('B');
    await toJudging(host, { gh, effects, head: A });
    await agentReturns(host, 'verify', { result: 'PASS', report: 'ok' }, { checkout: A, gh, effects });
    assert.equal(host.snapshot.value, 'waitingCi');

    // A red check on another commit is not the head's: nothing moves.
    gh.red(A);
    gh.checks[A][0].name = 'lint';
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'waitingCi', 'a non-required check does not count');

    gh.red(A);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'building', 'red with a build left: build again');
    assert.deepEqual(host.snapshot.context.failure, { kind: 'check', sha: A, url: `https://ci/${A}/test`, detail: 'test' });
    assert.deepEqual(openRun(host, 'build').input.failure, { kind: 'check', sha: A, url: `https://ci/${A}/test`, detail: 'test' }, 'the builder is handed the failing check');

    const branch = buildBranch(host);
    gh.push(1, B);
    await agentReturns(host, 'build', { pr: { branch, headSha: B, url: prUrl(1) } }, { gh, effects });
    assert.equal(host.snapshot.value, 'judging');
    gh.red(B);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'replanning', 'red with no build left: replanning');
    assert.equal(host.snapshot.context.failure.kind, 'check');
    assert.equal(host.snapshot.context.failure.sha, B);
    assert.equal(gh.merges.length, 0);
    assert.deepEqual(plat.cards.at(-1).choices, ['replan', 'drop']);
  } finally {
    await gh.close();
  }
});
