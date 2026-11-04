// Q5 Verifier misreports: the verifier returns PASS naming the right sha but its worktree is at another commit; the
// verdict must not count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, toJudging, agentReturns, wake, transitions, openRun, loadRun } from './world.js';
import { runDir } from '../../src/actors.js';

test('Q5: a PASS that names the head while the verifier worktree is at another commit does not count', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const { host, effects } = hostFor({ root, repo, gh, plat });
    const A = repo.commit('A');
    const B = repo.commit('B');
    await toJudging(host, { gh, effects, head: B });
    gh.green(B);
    // The agent says PASS for B, the right head, but it had A checked out.
    const got = await agentReturns(host, 'verify', { result: 'PASS', sha: B, report: 'all good at B' }, { checkout: A, gh, effects });
    assert.ok(got.results, 'the result itself is accepted (schema-valid)');
    const { verdict, pr } = host.snapshot.context;
    assert.equal(verdict.sha, A, 'the host wrote what the worktree was at, not what the agent said');
    assert.equal(pr.headSha, B);
    assert.equal(host.snapshot.value, 'replanning', 'the verdict does not count');
    await wake(host, { gh, effects });
    const states = transitions(root).map((r) => r.state);
    assert.ok(!states.some((s) => ['"waitingCi"', '"asking"', '"askingCi"', '"merging"'].includes(s)), states.join(' > '));
    assert.equal(gh.merges.length, 0);
    assert.deepEqual(plat.cards.map((c) => c.choices), [['replan', 'drop']], 'no merge card');
  } finally {
    await gh.close();
  }
});

test('Q5 control: the same PASS with the worktree at the head counts', async () => {
  const gh = await fakeGitHub();
  try {
    const repo = gitRepo();
    const { host, effects } = hostFor({ root: fresh(), repo, gh, plat: platform() });
    const B = repo.commit('B');
    await toJudging(host, { gh, effects, head: B });
    await agentReturns(host, 'verify', { result: 'PASS', sha: B, report: 'all good at B' }, { checkout: B, gh, effects });
    assert.equal(host.snapshot.value, 'waitingCi');
  } finally {
    await gh.close();
  }
});

// Round 2 graft (lane C): the host puts the subject in place. The verifier's worktree is detached at the PR head
// before the agent starts, and its prompt says so, so an honest verifier that never touches git is judged at the head.
test('Q5 graft: the host checks out the PR head for the verifier and says so in its prompt; an agent that moves nothing counts', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const { host, effects } = hostFor({ root, repo, gh, plat: platform() });
    const B = repo.commit('B');
    await toJudging(host, { gh, effects, head: B });
    const run = loadRun(root, openRun(host, 'verify').id);
    assert.equal(run.subject.kind, 'commit');
    assert.equal(run.subject.at, B);
    assert.equal(execFileSync('git', ['-C', run.worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), B, 'the worktree is at the head before the agent starts');
    const prompt = readFileSync(join(runDir(root, run.run), 'context.md'), 'utf8');
    assert.match(prompt, new RegExp(`checked out detached at commit ${B}`));
    assert.match(prompt, /Do not fetch, check out/);
    assert.match(prompt, /the host reads HEAD in this worktree itself/);
    assert.doesNotMatch(prompt, /on branch/, 'the verifier is not put on a fresh branch at the clone\'s HEAD');
    // No checkout by the agent at all.
    await agentReturns(host, 'verify', { result: 'PASS', report: 'all good' }, { gh, effects });
    assert.equal(host.snapshot.context.verdict.sha, B);
    assert.equal(host.snapshot.value, 'waitingCi');
  } finally {
    await gh.close();
  }
});

test('Q5 graft: HEAD is read at accept; moving the worktree after returning changes nothing', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const { host, effects } = hostFor({ root, repo, gh, plat: platform() });
    const A = repo.commit('A');
    const B = repo.commit('B');
    await toJudging(host, { gh, effects, head: B });
    const run = loadRun(root, openRun(host, 'verify').id);
    // Accepted at A (the agent moved HEAD before returning); the worktree is put back at B before delivery.
    const got = await agentReturns(host, 'verify', { result: 'PASS', report: 'ok' }, { checkout: A, gh, effects });
    assert.ok(got.results);
    execFileSync('git', ['-C', run.worktree, 'checkout', '-q', '--detach', B]);
    assert.equal(JSON.parse(readFileSync(join(runDir(root, run.run), 'result.json'), 'utf8')).head, A, 'the host\'s reading at accept');
    assert.equal(host.snapshot.context.verdict.sha, A);
    assert.equal(host.snapshot.value, 'replanning');
  } finally {
    await gh.close();
  }
});
