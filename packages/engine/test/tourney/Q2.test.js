// Q2 Push after PASS: the head moves after the verdict; no merge until the new head is verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, suiteWake, inputsOfWakeFor, tap, tapWake, cardOf, openRunOf, prOut, prUrl, verdictOut } from './world.js';

test('Q2 push after PASS: back to checking for B, the old card does nothing, merge only at B once B is verified and green', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const w = world({ gh });
    let { host } = await w.startItem('it-1', { issue: ISSUE });
    ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
    ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A })).input]));
    ({ host } = await w.send('it-1', [(await attested(host, 'verify', verdictOut('PASS', 1, A), { gh, worktreeHead: A })).input]));
    ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A))));
    assert.equal(host.snapshot.value, 'awaitingMerge');
    const oldCard = cardOf(host, openRunOf(host, 'approval'));

    gh.push(1, B);
    const push = { event: { type: 'pr', url: prUrl(1), branch: 'build/x', headSha: B }, source: { system: 'github', ref: `push ${B}` } };
    let results;
    ({ host, results } = await w.send('it-1', [push]));
    assert.equal(results[0].outcome, 'applied');
    assert.equal(host.snapshot.value, 'checking');
    const verify = w.agents.started.filter((e) => e.actor === 'verify').at(-1);
    assert.equal(verify.input.pr.headSha, B, 'the new verify run is for B');

    assert.deepEqual(inputsOfWakeFor(host, tapWake(oldCard, 0)), [], 'the approval asked about A offers nothing now');
    assert.equal(gh.merges.length, 0);

    // A green suite on the old head A does not count.
    ({ host, results } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A).replace('2026-10-30T18:06:40Z', '2026-10-30T18:07:00Z').replace(/"pr":"o\/r#1"/, '"pr":"o/r#1","x":1'))));
    assert.equal(host.snapshot.value, 'checking');

    // PASS at B alone (no suite on B yet) leaves it in checking.
    ({ host } = await w.send('it-1', [(await attested(host, 'verify', verdictOut('PASS', 1, B), { gh, worktreeHead: B })).input]));
    assert.equal(host.snapshot.value, 'checking', 'no merge card until CI is green on B');
    ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(B))));
    assert.equal(host.snapshot.value, 'awaitingMerge');
    const newCard = cardOf(host, openRunOf(host, 'approval'));
    assert.notEqual(newCard, oldCard);
    ({ host } = await w.send('it-1', tap(host, 'approval', 0)));
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: B }]);
  } finally {
    await gh.close();
  }
});
