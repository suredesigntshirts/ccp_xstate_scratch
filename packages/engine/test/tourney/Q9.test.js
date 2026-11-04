// Q9 Expect edited on GitHub: the issue's acceptance lines change mid-build (could be an agent); grading must not
// change without the person.
// Round 2 (lane E): the expect.observed event and its adopt card are removed. The Expect lines an item is graded on
// are its start input (context.issue.expect); the host never re-reads the issue, and no transition writes those lines,
// so an edit on GitHub, by anyone, cannot reach grading. A person who wants new lines starts a new item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, agentReturns, wake, tap, start, offer, openRun, buildBranch, prUrl, issueBody, ISSUE, BRIEFS, transitions } from './world.js';

test('Q9: an Expect edit on GitHub mid-build never changes what the item is graded on, and costs the person nothing', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const { host, effects } = hostFor({ root, repo, gh, plat });
    await offer(host, [start()], effects);
    await agentReturns(host, 'brief', BRIEFS, { gh, effects });
    assert.equal(host.snapshot.value, 'building');
    // Mid-build, the issue's Expect lines are edited on GitHub (by anyone with the account, an agent included).
    const edited = ['math.js exports multiply', 'nothing else is tested'];
    gh.issues[7].body = issueBody(edited);
    const heard = await wake(host, { gh, effects });
    assert.deepEqual(heard.filter((r) => r.outcome === 'applied'), [], 'the wake offers the item nothing');
    assert.equal(host.snapshot.value, 'building');
    assert.deepEqual(host.snapshot.context.issue.expect, ISSUE.expect, 'what the item is graded on is unchanged');
    assert.equal(plat.cards.length, 0, 'no card: the person is not asked');

    const A = repo.commit('A');
    const branch = buildBranch(host);
    gh.open(1, { head: A, branch });
    await agentReturns(host, 'build', { pr: { branch, headSha: A, url: prUrl(1) } }, { gh, effects });
    assert.equal(host.snapshot.value, 'judging');
    await wake(host, { gh, effects });
    const verify = openRun(host, 'verify');
    assert.deepEqual(verify.input.issue.expect, ISSUE.expect, 'the verifier grades against the start-time lines');
    assert.notDeepEqual(verify.input.issue.expect, edited);

    // Through to merge: the edited lines never appear in any transition's context.
    await agentReturns(host, 'verify', { result: 'PASS', report: 'multiply exported' }, { gh, effects });
    gh.green(A);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'asking');
    await tap(host, { effects, index: 0 });
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(host.snapshot.output.issue.expect, ISSUE.expect);
    assert.ok(!transitions(root).some((r) => JSON.stringify(r).includes('nothing else is tested')), 'the edit is in no journal row');
  } finally {
    await gh.close();
  }
});
