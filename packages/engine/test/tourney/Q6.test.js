// Q6 late push from a dead attempt: after a failure-driven replan, attempt 1's builder pushes; it must not affect
// attempt 2's gates or merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, ISSUE, BRIEFS, builds, verifies, tapWake, suiteWake, redWake, closedWake, offer, pending } from './world.js';

test('Q6: after a replan, every event and return from attempt 1 is refused or stale; attempt 2 merges its own PR', async () => {
  const w = await makeWorld();
  try {
    await w.start('q6', 'quick-fix', { issue: ISSUE });
    assert.ok((await w.agent('q6', 'brief', () => BRIEFS)).accepted);
    await w.drive('q6');
    // Attempt 1: two builds of PR 1, each verified FAIL.
    const oldBuildRuns = [];
    for (let i = 0; i < 2; i++) {
      oldBuildRuns.push(w.openRun('q6', 'build').id);
      assert.ok((await w.agent('q6', 'build', builds(w, 1), `ag-b1-${i}`)).accepted);
      await w.drive('q6');
      assert.ok((await w.agent('q6', 'verify', verifies(w, 'FAIL'))).accepted);
      await w.drive('q6');
    }
    assert.equal(w.host('q6').snapshot.value, 'replanning');
    // The person replans with a written why. A tap wake carries no text, so the ask run's answer (choice + why) is
    // handed to the item as that run's completion, sourced from the card.
    let h = w.host('q6');
    const ask = pending(h).runs.find((r) => r.actor === 'ask');
    await offer(h, [{ event: { type: `xstate.done.actor.${ask.invoke}`, output: { choice: 'replan', by: 'person', why: 'five whys: the brief missed the edge case' } }, run: ask.id, source: { system: 'hearth', ref: w.cardOf('q6') } }], w.handlersFor(h));
    assert.equal(w.host('q6').snapshot.value, 'briefing');
    assert.equal(w.host('q6').snapshot.context.pr, null);
    assert.ok((await w.agent('q6', 'brief', () => BRIEFS)).accepted);
    await w.drive('q6');
    assert.equal(w.openRun('q6', 'build').input.previous, null, 'attempt 2 builds without attempt 1\'s PR');
    assert.ok((await w.agent('q6', 'build', builds(w, 2, { green: false }))).accepted);
    await w.drive('q6');
    const B = w.gh.state[2].head;
    assert.equal(w.host('q6').snapshot.value, 'checking');
    assert.equal(w.host('q6').snapshot.context.pr.key, 'o/r#2');

    // Attempt 1's builder pushes C to PR 1: GitHub reports a suite, a red run and then merges it elsewhere.
    const C = w.commit(w.repo, 'late push from attempt 1');
    w.gh.push(1, C);
    const late = [];
    for (const wake of [suiteWake(C, 1), redWake(C, 1), closedWake(1)]) late.push(...(await w.drive('q6', wake)));
    assert.deepEqual(late.map((r) => r.outcome), ['refused', 'refused', 'refused']);
    // Attempt 1's builder returns again: its run is closed.
    const again = await w.agent('q6', 'build', builds(w, 2), 'x').catch((e) => e);
    assert.match(String(again.message), /no open build run/, 'no build run is open in checking');
    h = w.host('q6');
    const stale = await offer(h, [{ event: { type: 'xstate.done.actor.build', output: { pr: { url: 'https://github.com/o/r/pull/1', at: C, key: 'o/r#1', green: true } } }, run: oldBuildRuns[1], source: { system: 'harness', ref: 'late return' } }], w.handlersFor(h));
    assert.equal(stale[0].outcome, 'stale');
    h = w.host('q6');
    assert.equal(h.snapshot.value, 'checking');
    assert.equal(h.snapshot.context.pr.key, 'o/r#2');
    assert.equal(h.snapshot.context.pr.at, B);

    // Attempt 2 carries on to its own merge.
    w.gh.green(B);
    await w.drive('q6', suiteWake(B, 2));
    assert.equal(w.host('q6').snapshot.value, 'verifying');
    assert.ok((await w.agent('q6', 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('q6');
    await w.drive('q6', tapWake(w.cardOf('q6'), 0));
    assert.equal(w.host('q6').snapshot.value, 'done');
    assert.deepEqual(w.gh.merges, [{ number: 2, sha: B, base: 'main' }]);
  } finally {
    await w.close();
  }
});
