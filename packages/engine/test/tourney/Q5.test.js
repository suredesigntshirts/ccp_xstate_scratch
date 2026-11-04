// Q5 verifier misreports: the verifier returns PASS naming the right sha but its worktree is at another commit; the
// verdict must not count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { actors, accept, bind, deliver, spawn, resultsOf, loadRun, runDir } from '../../src/actors.js';
import { fakeGitHub, fresh, gitRepo, handlers, loadWorkflow, offer, open, openRun, prOf, rows, start } from './world-b.js';

const spec = loadWorkflow('quick-fix');
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const startAgent = (root, run, agentId) => {
  spawn({ root, prompt: `ccp-run ${run}`, toolUseId: `toolu_${agentId}` });
  bind({ root, agentId, toolUseId: `toolu_${agentId}` });
};

test('Q5: PASS naming the PR head Y from a worktree moved to X is refused (worktree-head) and never reaches the item', async () => {
  const repo = gitRepo();
  const X = git('-C', repo, 'rev-parse', 'HEAD');
  git('-C', repo, 'branch', 'pr-branch');
  git('-C', repo, 'checkout', '-q', 'pr-branch');
  git('-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'two');
  const Y = git('-C', repo, 'rev-parse', 'HEAD');
  git('-C', repo, 'checkout', '-q', '-'); // the clone's HEAD is X again
  assert.notEqual(X, Y);
  const gh = await fakeGitHub({ 1: { head: Y } }, { [Y]: ['math.js'] });
  try {
    const root = fresh('q5');
    const worktrees = join(root, 'wt');
    const host = open(root, spec, { session: 's' });
    await offer(host, [start({ issue: ISSUE }, 's')], handlers({ actors: actors({ host, repo, worktrees }) }));
    const brief = openRun(host, 'brief').id;
    startAgent(root, brief, 'ag-brief');
    assert.ok((await accept({ root, caller: 'ag-brief', run: brief, result: { builder: 'b', verifier: 'v' }, github: gh.client })).accepted);
    await deliver({ root, run: brief, github: gh.client });
    const build = openRun(open(root, spec, { session: 's' }), 'build').id;
    startAgent(root, build, 'ag-build');
    assert.ok((await accept({ root, caller: 'ag-build', run: build, result: { pr: prOf(1, Y) }, github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: build, github: gh.client })).state, 'verifying');
    const verify = openRun(open(root, spec, { session: 's' }), 'verify').id;
    const wt = loadRun(root, verify).worktree;
    // Graft (lane C): the host put the subject in place. The verifier's worktree starts at the PR head Y, and its
    // prompt says so instead of asking it to fetch and check out.
    assert.equal(git('-C', wt, 'rev-parse', 'HEAD'), Y, 'the host placed the verifier worktree at the PR head');
    const context = readFileSync(join(runDir(root, verify), 'context.md'), 'utf8');
    assert.match(context, new RegExp(`the host checked it out at ${Y}, the commit you work on`));
    assert.match(context, /Do not fetch, check out, reset or commit: a verdict from any other HEAD is refused/);
    assert.doesNotMatch(context, /git fetch/);
    assert.match(context, /`sha` must be the commit your worktree's HEAD is at when you return/);
    startAgent(root, verify, 'ag-verify');

    // The verifier misreports: it moves its worktree to X, then returns PASS naming the PR head Y.
    git('-C', wt, 'checkout', '-q', '--detach', X);

    const mis = await accept({ root, caller: 'ag-verify', run: verify, result: { result: 'PASS', sha: Y, ciChanged: false, report: 'ok' }, github: gh.client });
    assert.equal(mis.refused?.rule, 'worktree-head');
    let after = open(root, spec, { session: 's' });
    assert.deepEqual(resultsOf(after), [], 'the misreported verdict never becomes an event');
    assert.equal(after.snapshot.value, 'verifying');
    assert.equal(after.snapshot.context.verdict, null);
    assert.equal(openRun(after, 'ask'), null, 'no merge card');
    assert.equal(rows(root).filter((r) => r.kind === 'refusal' && r.payload.rule === 'worktree-head').length, 1);

    // The control: once the worktree really is at Y, the same verdict counts.
    git('-C', wt, 'checkout', '-q', '--detach', Y);
    assert.ok((await accept({ root, caller: 'ag-verify', run: verify, result: { result: 'PASS', sha: Y, ciChanged: false, report: 'ok' }, github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: verify, github: gh.client })).state, 'waitingCi');
    after = open(root, spec, { session: 's' });
    assert.equal(after.snapshot.context.verdict.sha, Y);
  } finally {
    await gh.close();
  }
});

test('Q5 (graft): a PR head the host cannot place fails the verify run; no worktree at another commit is handed out', async () => {
  const repo = gitRepo();
  const Z = 'f'.repeat(40); // on GitHub only: not in the clone, and the clone has no origin to fetch it from
  const gh = await fakeGitHub({ 1: { head: Z } }, { [Z]: ['math.js'] });
  try {
    const root = fresh('q5z');
    const worktrees = join(root, 'wt');
    const host = open(root, spec, { session: 's' });
    await offer(host, [start({ issue: ISSUE }, 's')], handlers({ actors: actors({ host, repo, worktrees }) }));
    const brief = openRun(host, 'brief').id;
    startAgent(root, brief, 'ag-brief');
    assert.ok((await accept({ root, caller: 'ag-brief', run: brief, result: { builder: 'b', verifier: 'v' }, github: gh.client })).accepted);
    await deliver({ root, run: brief, github: gh.client });
    const build = openRun(open(root, spec, { session: 's' }), 'build').id;
    startAgent(root, build, 'ag-build');
    assert.ok((await accept({ root, caller: 'ag-build', run: build, result: { pr: prOf(1, Z) }, github: gh.client })).accepted);
    await deliver({ root, run: build, github: gh.client });
    const after = open(root, spec, { session: 's' });
    assert.equal(after.snapshot.value, 'replanning', 'the verify run failed to start, so the item escalates');
    assert.equal(after.snapshot.context.failure.kind, 'actor');
    assert.match(String(after.snapshot.context.failure.error), /could not place the subject/);
    assert.equal(after.snapshot.context.verdict, null, 'no verdict');
    const failed = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.phase === 'failed');
    assert.equal(failed.length, 1, 'one effect failed: the verify run');
    assert.match(failed[0].payload.effect, /\.verify$/);
    assert.match(failed[0].payload.reason, /could not place the subject: commit f{40}/);
    assert.equal(rows(root).filter((r) => r.kind === 'brief.stored' && r.payload.actor === 'verify').length, 0, 'no verify run was prepared');
  } finally {
    await gh.close();
  }
});
