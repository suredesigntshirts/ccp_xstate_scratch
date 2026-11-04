// Q6 Late push from a dead attempt: after a failure-driven replan, attempt 1's builder pushes; it must not affect
// attempt 2's gates or merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, toJudging, agentReturns, wake, tap, buildBranch, prUrl, replanWithWhy, BRIEFS } from './world.js';

const checkRunWake = (head) => `<wake reason="github" current-time="2026-11-03T10:00:00Z">
<event source="github" kind="check_run.completed">{"check":"test","conclusion":"success","head_sha":"${head}","pr":"o/r#1"}</event>
</wake>`;

test('Q6: attempt 1 pushes after the replan; attempt 2 gates and merges on its own PR only', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const { host, effects } = hostFor({ root, repo, gh, plat });
    const [A1, A2, B, C] = ['A1', 'A2', 'B', 'C'].map((m) => repo.commit(m));

    // Attempt 1: two builds on it-1/a1, both FAIL; no build left -> replanning.
    const a1 = await toJudging(host, { gh, effects, head: A1 });
    assert.equal(a1, 'it-1/a1');
    await agentReturns(host, 'verify', { result: 'FAIL', report: 'multiply missing' }, { checkout: A1, gh, effects });
    assert.equal(host.snapshot.value, 'building');
    gh.push(1, A2);
    await agentReturns(host, 'build', { pr: { branch: a1, headSha: A2, url: prUrl(1) } }, { gh, effects });
    await agentReturns(host, 'verify', { result: 'FAIL', report: 'still missing' }, { checkout: A2, gh, effects });
    assert.equal(host.snapshot.value, 'replanning');

    // The person replans: the item lets go of the dead attempt's PR (round 2: no close effect; the PR stays open on
    // GitHub), and attempt 2 gets its own branch.
    await replanWithWhy(host, 'the brief missed the export; five whys: ...', effects);
    assert.equal(host.snapshot.context.pr, null, 'the item no longer holds the dead attempt\'s PR');
    assert.deepEqual(gh.closes, [], 'nothing is closed: isolation does not rest on closing it');
    assert.equal(gh.prs[1].state, 'open');
    await agentReturns(host, 'brief', BRIEFS, { gh, effects });
    assert.equal(host.snapshot.value, 'building');
    assert.equal(host.snapshot.context.attempt, 2);
    const a2 = buildBranch(host);
    assert.equal(a2, 'it-1/a2');

    // The dead attempt's builder pushes C to PR #1, and its CI goes green.
    gh.push(1, C);
    gh.green(C);
    // A wake now: the host observes only the PR the item holds (none), so the push and its green CI offer nothing.
    const quiet = await wake(host, { gh, effects });
    assert.deepEqual(quiet.filter((r) => r.outcome === 'applied'), []);
    assert.equal(host.snapshot.value, 'building');
    // A claim of the dead attempt's PR as attempt 2's result is refused: not this attempt's branch.
    const stray = await agentReturns(host, 'build', { pr: { branch: a1, headSha: C, url: prUrl(1) } }, { gh, effects });
    assert.equal(stray.refused?.rule, 'wrong-branch');
    assert.equal(host.snapshot.value, 'building');

    // Attempt 2's own PR.
    gh.open(2, { head: B, branch: a2 });
    await agentReturns(host, 'build', { pr: { branch: a2, headSha: B, url: prUrl(2) } }, { gh, effects });
    assert.equal(host.snapshot.context.pr.url, prUrl(2));
    // GitHub's check-run wake for the dead attempt's head offers nothing the item takes.
    const late = await wake(host, { gh, effects, text: checkRunWake(C) });
    assert.ok(late.every((r) => r.outcome !== 'applied' || r.row.payload.event.type !== 'github.check_run.completed'));
    assert.equal(host.snapshot.value, 'judging');

    await agentReturns(host, 'verify', { result: 'PASS', report: 'ok' }, { checkout: B, gh, effects });
    assert.equal(host.snapshot.value, 'waitingCi', 'C\'s green CI is not attempt 2\'s CI');
    gh.green(B);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'asking');
    assert.equal(host.snapshot.context.ci.sha, B);
    await tap(host, { effects, index: 0 });
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges, [{ number: 2, sha: B }], 'only attempt 2\'s PR merges, at its verified head');
    assert.equal(gh.prs[1].merged, false);
  } finally {
    await gh.close();
  }
});
