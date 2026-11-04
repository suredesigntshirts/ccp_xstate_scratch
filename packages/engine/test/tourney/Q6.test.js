// Q6 Late push from a dead attempt: after a failure-driven replan, attempt 1's builder pushes; it must not affect
// attempt 2's gates or merge. Attempt 2 is a child item (items effect) with its own, empty board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, C, D, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, suiteWake, redWake, inputsOfWakeFor, tap, replanWithWhy, openRunOf, prOut, prUrl, verdictOut } from './world.js';

test('Q6 late push from attempt 1 is refused by attempt 2 and by the parent; attempt 2 merges its own PR at its own head', async () => {
  const gh = await fakeGitHub({ 1: { head: A }, 2: { head: C, branch: 'build/y' } });
  try {
    const w = world({ gh });
    let { host } = await w.startItem('it-1', { issue: ISSUE });
    ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
    ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A })).input]));
    ({ host } = await w.send('it-1', [(await attested(host, 'verify', verdictOut('FAIL', 1, A), { gh, worktreeHead: A })).input]));
    assert.equal(host.snapshot.value, 'building');
    gh.push(1, B);
    ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, B), { gh, worktreeHead: B })).input]));
    ({ host } = await w.send('it-1', [(await attested(host, 'verify', verdictOut('FAIL', 1, B), { gh, worktreeHead: B })).input]));
    assert.equal(host.snapshot.value, 'replanning');
    const lastBuild = w.agents.started.filter((e) => e.actor === 'build' && e.id.startsWith('it-1:')).at(-1);

    ({ host } = await w.send('it-1', replanWithWhy(host, 'five whys: the brief missed the edge case')));
    assert.equal(host.snapshot.value, 'replanned');
    const attemptRun = openRunOf(host, 'attempt');
    const child = `${attemptRun.id.replace(':', '~')}.0`;
    let kid = w.open(child);
    assert.equal(kid.snapshot.value, 'briefing', 'attempt 2 started as a child item');
    assert.deepEqual(Object.keys(kid.snapshot.context.facts), ['input'], 'with an empty board');
    assert.equal(kid.snapshot.context.facts.input.v.why, 'five whys: the brief missed the edge case');

    ({ host: kid } = await w.send(child, [returned(kid, 'briefs', BRIEFS)]));
    ({ host: kid } = await w.send(child, [(await attested(kid, 'pr', prOut(2, C, 'build/y'), { gh, worktreeHead: C })).input]));
    assert.equal(kid.snapshot.value, 'checking');

    // Attempt 1's builder pushes D to PR #1.
    gh.push(1, D);
    const late = { event: { type: 'pr', url: prUrl(1), branch: 'build/x', headSha: D }, source: { system: 'github', ref: `push ${D}` } };
    let results;
    ({ host: kid, results } = await w.send(child, [late]));
    assert.equal(results[0].outcome, 'refused', 'attempt 2 refuses a push for PR #1');
    assert.equal(kid.snapshot.context.facts.pr.v.headSha, C);
    ({ host: kid, results } = await w.send(child, inputsOfWakeFor(kid, redWake(D, 1))));
    assert.equal(results[0].outcome, 'refused', 'and a red check on #1\'s new head');
    ({ results } = await w.send('it-1', [{ ...late, source: { system: 'github', ref: `push ${D} again` } }]));
    assert.equal(results[0].outcome, 'refused', 'the parent takes no push at all');
    ({ results } = await w.send('it-1', [{ event: { type: 'xstate.done.actor.pr', output: prOut(1, D) }, run: lastBuild.id, source: { system: 'harness', ref: 'late return' } }]));
    assert.equal(results[0].outcome, 'stale', 'attempt 1\'s late build result is stale');

    ({ host: kid } = await w.send(child, [(await attested(kid, 'verify', verdictOut('PASS', 2, C), { gh, worktreeHead: C })).input]));
    ({ host: kid } = await w.send(child, inputsOfWakeFor(kid, suiteWake(C, 2))));
    assert.equal(kid.snapshot.value, 'awaitingMerge');
    ({ host: kid } = await w.send(child, tap(kid, 'approval', 0)));
    assert.equal(kid.snapshot.value, 'done');

    const adv = await w.advance('it-1');
    assert.equal(adv.inputs.length, 1);
    assert.equal(adv.host.snapshot.value, 'done');
    assert.equal(adv.host.snapshot.output.attempt.done, 1);
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 2, sha: C }]);
  } finally {
    await gh.close();
  }
});
