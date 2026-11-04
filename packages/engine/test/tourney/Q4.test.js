// Q4 CI edited by the builder: the PR changes CI config and CI turns green; it must not merge on that green without
// the person explicitly approving a CI-changing PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { actors, accept, bind, deliver, spawn, resultsOf } from '../../src/actors.js';
import { A, agents, fakeGitHub, fresh, gitRepo, handlers, loadWorkflow, offer, open, openRun, platform, prOf, rows, start, suite, tap, world } from './world-b.js';

const spec = loadWorkflow('quick-fix');
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };

async function toCiApproval() {
  const gh = await fakeGitHub({ 1: { head: A } });
  const plat = platform();
  const host = open(fresh('q4'), spec);
  const a = agents({ brief: [{ builder: 'b', verifier: 'v' }], build: [{ pr: prOf(1, A) }], verify: [{ result: 'PASS', sha: A, ciChanged: true, report: 'ok' }] });
  const fx = world({ gh, plat, actors: a.byActor });
  await offer(host, [start({ issue: ISSUE })], fx);
  await offer(host, suite(host, A), fx);
  return { gh, plat, host, fx };
}

test('Q4a: a CI-changing PR, CI green, waits on a card that names the CI change; no merge without that approval', async () => {
  const { gh, plat, host, fx } = await toCiApproval();
  try {
    assert.equal(host.snapshot.value, 'awaitingCiApproval', 'green CI on a CI-changing head does not lead to the ordinary merge card');
    assert.equal(gh.merges.length, 0, 'no merge on CI green alone');
    assert.equal(plat.cards.length, 1);
    assert.match(plat.cards[0].question, /changes CI/);
    assert.deepEqual(plat.cards[0].choices, ['approve CI change', 'reject']);
    await offer(host, tap(host, 0), fx); // the person taps "approve CI change"
    assert.equal(host.snapshot.value, 'done');
    assert.equal(host.snapshot.context.decision.choice, 'approve CI change');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);
  } finally {
    await gh.close();
  }
});

test('Q4a: rejecting the CI change goes to replanning, never merging', async () => {
  const { gh, host, fx } = await toCiApproval();
  try {
    await offer(host, tap(host, 1), fx); // "reject"
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});

// The real agent actors: runs prepared by the host, agents bound as the hooks bind them, results through accept().
const startAgent = (root, run, agentId) => {
  spawn({ root, prompt: `ccp-run ${run}`, toolUseId: `toolu_${agentId}` });
  bind({ root, agentId, toolUseId: `toolu_${agentId}` });
};

test('Q4b: a verifier that says ciChanged:false about a PR touching .github/ is refused at accept; the true claim leads to the CI-change card', async () => {
  const repo = gitRepo();
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const gh = await fakeGitHub({ 1: { head } }, { [head]: ['math.js', '.github/workflows/ci.yml'] });
  try {
    const root = fresh('q4b');
    const worktrees = join(root, 'wt');
    let host = open(root, spec, { session: 's' });
    await offer(host, [start({ issue: ISSUE }, 's')], handlers({ actors: actors({ host, repo, worktrees }) }));
    const brief = openRun(host, 'brief').id;
    startAgent(root, brief, 'ag-brief');
    assert.ok((await accept({ root, caller: 'ag-brief', run: brief, result: { builder: 'b', verifier: 'v' }, github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: brief, github: gh.client })).state, 'building');
    const build = openRun(open(root, spec, { session: 's' }), 'build').id;
    startAgent(root, build, 'ag-build');
    assert.ok((await accept({ root, caller: 'ag-build', run: build, result: { pr: prOf(1, head) }, github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: build, github: gh.client })).state, 'verifying');
    const verify = openRun(open(root, spec, { session: 's' }), 'verify').id;
    startAgent(root, verify, 'ag-verify');

    const lie = await accept({ root, caller: 'ag-verify', run: verify, result: { result: 'PASS', sha: head, ciChanged: false, report: 'ok' }, github: gh.client });
    assert.equal(lie.refused?.rule, 'ci-changed');
    assert.match(lie.refused.reason, /\.github\/workflows\/ci\.yml/);
    host = open(root, spec, { session: 's' });
    assert.deepEqual(resultsOf(host), [], 'the false claim never reaches the item');
    assert.equal(host.snapshot.value, 'verifying');
    assert.equal(rows(root).filter((r) => r.kind === 'refusal' && r.payload.rule === 'ci-changed').length, 1);

    assert.ok((await accept({ root, caller: 'ag-verify', run: verify, result: { result: 'PASS', sha: head, ciChanged: true, report: 'ok' }, github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: verify, github: gh.client })).state, 'waitingCi');
    const plat = platform();
    host = open(root, spec, { session: 's' });
    const fx = world({ gh, plat, actors: actors({ host, repo, worktrees }) });
    await offer(host, suite(host, head), fx);
    assert.equal(host.snapshot.value, 'awaitingCiApproval');
    assert.equal(gh.merges.length, 0, 'CI green on a CI-changing PR does not merge');
    assert.match(plat.cards[0].question, /changes CI/);
    await offer(host, tap(host, 0), fx);
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: head }]);
  } finally {
    await gh.close();
  }
});
