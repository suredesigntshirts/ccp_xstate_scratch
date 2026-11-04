// Q4 CI edited by the builder: the PR changes CI config and CI turns green; it must not merge on that green without
// the person explicitly approving a CI-changing PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, toJudging, agentReturns, wake, tap, openRun } from './world.js';

async function toGreenCiEdit() {
  const gh = await fakeGitHub();
  const root = fresh();
  const repo = gitRepo();
  const plat = platform();
  const { host, effects } = hostFor({ root, repo, gh, plat });
  const A = repo.commit('A');
  await toJudging(host, { gh, effects, head: A, files: ['math.js', '.github/workflows/ci.yml'] });
  await agentReturns(host, 'verify', { result: 'PASS', report: 'ok' }, { checkout: A, gh, effects });
  gh.green(A);
  await wake(host, { gh, effects });
  return { gh, host, effects, plat, A };
}

test('Q4: green CI on a PR that edits .github/** goes to a card that says so; no merge without that explicit approval', async () => {
  const { gh, host, effects, plat, A } = await toGreenCiEdit();
  try {
    assert.equal(host.snapshot.context.ci.touchesCi, true, 'the host saw the PR touch CI config');
    assert.equal(host.snapshot.value, 'askingCi', 'not the ordinary merge card');
    assert.match(plat.cards.at(-1).question, /edits CI config/);
    assert.equal(gh.merges.length, 0, 'green CI alone does not merge');
    // More green observations change nothing: still waiting on the person.
    await wake(host, { gh, effects });
    assert.equal(gh.merges.length, 0);
    assert.equal(plat.cards.length, 1);

    await tap(host, { effects, index: 0 });
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges, [{ number: 1, sha: A }], 'merged only after the explicit approval of the CI-changing PR');
    assert.equal(host.snapshot.context.approval.touchesCi, true, 'the approval records that it approved a CI change');
  } finally {
    await gh.close();
  }
});

test('Q4: rejecting the CI-changing PR never merges it', async () => {
  const { gh, host, effects } = await toGreenCiEdit();
  try {
    await tap(host, { effects, index: 1 });
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});

test('Q4: an approval of a PR without CI changes does not carry over to a later CI-changing head', async () => {
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
    gh.green(A);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'asking');
    // The builder pushes a CI edit before the tap lands; CI goes green on it.
    gh.push(1, B);
    gh.prs[1].files = ['math.js', '.github/workflows/ci.yml'];
    gh.green(B);
    await wake(host, { gh, effects });
    await agentReturns(host, 'verify', { result: 'PASS', report: 'ok' }, { checkout: B, gh, effects });
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'askingCi');
    assert.equal(gh.merges.length, 0);
    assert.ok(openRun(host, 'ask'), 'a new explicit card is needed');
  } finally {
    await gh.close();
  }
});
