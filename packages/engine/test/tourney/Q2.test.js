// Q2 Push after PASS: the head moves after the verdict; no merge until the new head is verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, toJudging, agentReturns, wake, tap, tapWake, cardOf } from './world.js';
import { inputsOfWake as wakeInputs } from '../../src/index.js';

test('Q2: a push after PASS re-judges the new head; the old approval card is dead; merge only at the new verified head', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const { host, effects } = hostFor({ root, repo, gh, plat });
    const A = repo.commit('A');
    const B = repo.commit('B');
    await toJudging(host, { gh, effects, head: A });
    await agentReturns(host, 'verify', { result: 'PASS', report: 'ok at A' }, { checkout: A, gh, effects });
    gh.green(A);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'asking');
    const oldCard = cardOf(host);

    // The head moves to B after the PASS at A.
    gh.push(1, B);
    gh.green(B);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'judging', 'the push sends the item back to be judged');
    assert.equal(host.snapshot.context.pr.headSha, B);

    // A tap on the old card offers nothing: its ask run is gone.
    assert.deepEqual(wakeInputs(host, tapWake(oldCard, 0), { now: '2999-01-01T00:00:00Z' }), []);
    // CI green at B alone does not reach the card: no verdict at B yet.
    await wake(host, { gh, effects });
    assert.notEqual(host.snapshot.value, 'asking');
    assert.equal(gh.merges.length, 0, 'no merge until the new head is verified');

    await agentReturns(host, 'verify', { result: 'PASS', report: 'ok at B' }, { checkout: B, gh, effects });
    assert.equal(host.snapshot.value, 'asking', 'PASS at B with green CI at B: the person is asked again');
    assert.notEqual(cardOf(host), oldCard);
    await tap(host, { effects, index: 0 });
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges, [{ number: 1, sha: B }]);
  } finally {
    await gh.close();
  }
});
