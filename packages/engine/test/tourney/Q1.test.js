// Q1 Happy path: issue -> brief -> build -> verify PASS -> CI green -> person approves -> merged at the verified head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, toJudging, agentReturns, wake, tap, transitions } from './world.js';

test('Q1: issue to merged at the verified head, with one person tap', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const { host, effects } = hostFor({ root, repo, gh, plat });
    const A = repo.commit('A');
    await toJudging(host, { gh, effects, head: A });
    assert.equal(host.snapshot.value, 'judging');

    await agentReturns(host, 'verify', { result: 'PASS', report: 'all Expect lines hold' }, { checkout: A, gh, effects });
    assert.equal(host.snapshot.value, 'waitingCi', 'PASS with CI not yet seen waits for CI');
    assert.equal(host.snapshot.context.verdict.sha, A, 'verdict.sha is the head the host saw in the verifier worktree');

    gh.green(A);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'asking');
    assert.equal(plat.cards.length, 1);
    assert.equal(gh.merges.length, 0, 'nothing merges before the person approves');

    await tap(host, { effects, index: 0 });
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges, [{ number: 1, sha: A }], 'merged once, at the verified head');
    assert.equal(host.snapshot.context.approval.sha, A);
    const taps = transitions(root).filter((r) => r.source.system === 'hearth').length;
    assert.equal(taps, 1, 'one person tap on the happy path');
  } finally {
    await gh.close();
  }
});
