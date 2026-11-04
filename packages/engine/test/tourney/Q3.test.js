// Q3 Red CI: a required check fails on the head; with a build left the item rebuilds carrying the failing check as a
// typed failure; with none left it goes to replanning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, redWake, inputsOfWakeFor, prOut } from './world.js';

test('Q3 red CI: rebuild with the failing check as typed input, then replanning when no build is left; a red on an old head is refused', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const w = world({ gh });
    let { host } = await w.startItem('it-1', { issue: ISSUE });
    ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
    ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A })).input]));
    assert.equal(host.snapshot.value, 'checking');

    let results;
    ({ host, results } = await w.send('it-1', inputsOfWakeFor(host, redWake(A))));
    assert.equal(results[0].outcome, 'applied');
    assert.equal(host.snapshot.value, 'building', 'a build is left: rebuild');
    const builds = w.agents.started.filter((e) => e.actor === 'build');
    assert.equal(builds.length, 2);
    const failure = builds[1].input.ci.check_run.completed.v;
    assert.deepEqual([failure.check, failure.conclusion, failure.head_sha], ['test', 'failure', A], 'the second build gets the failing check, typed');
    assert.ok(failure.details_url);

    gh.push(1, B);
    ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, B), { gh, worktreeHead: B })).input]));
    assert.equal(host.snapshot.value, 'checking');
    assert.equal(host.snapshot.context.facts.pr.n, 2);

    // A red check on the old head A is refused while the PR is at B.
    ({ host, results } = await w.send('it-1', inputsOfWakeFor(host, redWake(A).replace('2026-10-30T17:02:44Z', '2026-10-30T17:09:00Z').replace('"check":"test"', '"check":"lint"'))));
    assert.equal(results[0].outcome, 'refused');
    assert.equal(host.snapshot.value, 'checking');

    ({ host, results } = await w.send('it-1', inputsOfWakeFor(host, redWake(B))));
    assert.equal(results[0].outcome, 'applied');
    assert.equal(host.snapshot.value, 'replanning', 'no build left: replan');
    assert.equal(w.agents.started.filter((e) => e.actor === 'build').length, 2, 'no third build');
    assert.equal(w.plat.cards.length, 1);
    assert.match(w.plat.cards[0].question, /five whys/);
  } finally {
    await gh.close();
  }
});
