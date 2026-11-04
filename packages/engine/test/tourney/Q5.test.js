// Q5 Verifier misreports: the verifier returns PASS naming the right sha but its worktree is at another commit; the
// verdict must not count. Driven with the real agent actors (run folders, worktrees, accept(), deliver()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { actors, accept, attest, bind, deliver, spawn, resultsOf, stopped, runDir } from '../../src/actors.js';
import { readFileSync } from 'node:fs';
import { handlers } from '../../src/effects/index.js';
import { gitRepo } from '../parity/world.js';
import { A, X, BRIEFS, ISSUE, fakeGitHub, fresh, offer, openRun, rows, prOut, verdictOut, loadWorkflow, RELEASE } from './world.js';
import { restore } from '../../src/index.js';

const open = (root) => restore({ root, item: 'it-1', spec: loadWorkflow('quick-fix'), session: 's', release: RELEASE });
const startAgent = (root, run, agentId) => {
  spawn({ root, prompt: `ccp-run ${run}`, toolUseId: `toolu_${agentId}` });
  bind({ root, agentId, toolUseId: `toolu_${agentId}` });
};
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();

test('Q5 attest: PASS naming the PR head, from a worktree at another commit, is refused (worktree-head)', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const got = await attest({ root: fresh(), result: verdictOut('PASS', 1, A), worktreeHead: X, github: gh.client });
    assert.equal(got.refused?.rule, 'worktree-head');
    const ok = await attest({ root: fresh(), result: verdictOut('PASS', 1, A), worktreeHead: A, github: gh.client });
    assert.equal(ok.seen.github.head, A, 'control: the same claim from a worktree at A is taken');
  } finally {
    await gh.close();
  }
});

test('Q5 real accept: the misreported PASS never reaches the item; its run fails and the item replans with no verdict fact and no merge', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const root = fresh('q5');
    const repo = gitRepo();
    const worktrees = join(root, 'wt');
    const effects = (host) => handlers({ github: gh.client, actors: actors({ host, repo, worktrees }) });
    let host = open(root);
    await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 's' } }], effects(host));
    const brief = openRun(host, 'brief').id;
    startAgent(root, brief, 'ag-brief');
    assert.ok((await accept({ root, caller: 'ag-brief', run: brief, result: BRIEFS, github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: brief, github: gh.client })).state, 'building');

    // The builder commits in its worktree and the PR is at that commit on GitHub.
    host = open(root);
    const build = openRun(host, 'build');
    startAgent(root, build.id, 'ag-build');
    const buildWt = join(worktrees, `it-1--${build.id.split(':')[1]}`);
    git(buildWt, 'commit', '-q', '--allow-empty', '-m', 'the fix');
    const S = git(buildWt, 'rev-parse', 'HEAD');
    gh.push(1, S);
    const built = await accept({ root, caller: 'ag-build', run: build.id, result: prOut(1, S), github: gh.client });
    assert.ok(built.accepted, JSON.stringify(built.refused));
    assert.equal((await deliver({ root, run: build.id, github: gh.client })).state, 'checking');

    // The verifier's worktree is at the repo's first commit, not S; it claims PASS at S anyway.
    host = open(root);
    const verify = openRun(host, 'verify');
    assert.equal(verify.input.pr.headSha, S);
    startAgent(root, verify.id, 'ag-verify');
    const told = readFileSync(join(runDir(root, verify.id), 'context.md'), 'utf8');
    assert.match(told, /worktree's HEAD must be that same commit/, 'the verifier is told the worktree-head rule it will be held to');
    const lie = await accept({ root, caller: 'ag-verify', run: verify.id, result: verdictOut('PASS', 1, S), github: gh.client });
    assert.equal(lie.refused?.rule, 'worktree-head');
    assert.ok(rows(root, 'it-1').some((r) => r.kind === 'refusal' && r.payload.rule === 'worktree-head' && r.payload.run === verify.id), 'the refusal is journalled');
    assert.deepEqual(resultsOf(open(root)), [], 'no verify done reaches the item');
    assert.equal(open(root).snapshot.value, 'checking');

    // The verifier stops without a counted result: sent back once, then its run fails, and the item steps back.
    assert.ok(stopped({ root, agentId: 'ag-verify' }).block);
    assert.ok(stopped({ root, agentId: 'ag-verify', again: true }).failed);
    const after = await deliver({ root, run: verify.id, github: gh.client });
    assert.equal(after.state, 'replanning');
    host = open(root);
    assert.equal(host.snapshot.context.facts.verify.v, undefined, 'no verdict fact was ever recorded');
    assert.ok(host.snapshot.context.facts.verify.err, 'only the error is');
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});
