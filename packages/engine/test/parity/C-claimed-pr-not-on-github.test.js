// C-claimed-pr-not-on-github (plan/cases/work-item.md): a builder returns a PR number and head; when GitHub shows no
// such PR or a different head, the completion is refused with the missing fact named, and the item stays in building.
// The agent actors are the real ones (src/actors.js): runs prepared by the host, agents bound as the harness hooks
// bind them, results through accept() and deliver(). GitHub is a local server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { actors, accept, bind, deliver, spawn, resultsOf } from '../../src/actors.js';
import { A, B, BRIEFS, PR_URL, fakeGitHub, fresh, gitRepo, handlers, offer, open, openRun, rows, start } from './world.js';

// Start the run's agent the way the hooks do: the Agent call's PreToolUse, then SubagentStart.
const startAgent = (root, run, agentId) => {
  spawn({ root, prompt: `ccp-run ${run}`, toolUseId: `toolu_${agentId}` });
  bind({ root, agentId, toolUseId: `toolu_${agentId}` });
};
const claim = (headSha, url = PR_URL) => ({ pr: { branch: 'build/x', headSha, url } });

// An item of quick-fix in building, its build run prepared and its agent started.
async function building(gh) {
  const root = fresh();
  const repo = gitRepo();
  const worktrees = join(root, 'wt');
  const host = open(root, { session: 's' });
  await offer(host, [start('s')], handlers({ actors: actors({ host, repo, worktrees }) }));
  const brief = openRun(host, 'brief').id;
  startAgent(root, brief, 'ag-brief');
  assert.ok((await accept({ root, caller: 'ag-brief', run: brief, result: BRIEFS, github: gh.client })).accepted);
  assert.equal((await deliver({ root, run: brief, github: gh.client })).state, 'building');
  const after = open(root, { session: 's' });
  const build = openRun(after, 'build').id;
  startAgent(root, build, 'ag-build');
  return { root, build };
}

test('C-claimed-pr-not-on-github: a PR GitHub doesn\'t have, or has at another head, is refused naming the fact, and the item stays in building', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { root, build } = await building(gh);
    const missing = await accept({ root, caller: 'ag-build', run: build, result: claim(A, 'https://github.com/o/r/pull/99'), github: gh.client });
    assert.equal(missing.refused.rule, 'github-fact');
    assert.match(missing.refused.reason, /pull\/99: GitHub shows no such PR/);
    const moved = await accept({ root, caller: 'ag-build', run: build, result: claim(B), github: gh.client });
    assert.equal(moved.refused.rule, 'github-fact');
    assert.match(moved.refused.reason, new RegExp(`GitHub shows ${PR_URL} at head ${A}, not the claimed ${B}`));

    const host = open(root, { session: 's' });
    assert.equal(host.snapshot.value, 'building');
    assert.deepEqual(resultsOf(host), [], 'nothing reaches the item');
    const refusals = rows(root).filter((r) => r.kind === 'refusal' && r.payload.rule === 'github-fact');
    assert.equal(refusals.length, 2, 'both refusals are journalled');

    // The true claim is taken, and the item moves on (the control).
    assert.ok((await accept({ root, caller: 'ag-build', run: build, result: claim(A), github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: build, github: gh.client })).state, 'verifying');
  } finally {
    await gh.close();
  }
});
