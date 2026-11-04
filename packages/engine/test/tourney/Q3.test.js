// Q3 red CI: a required check fails on the head; with a build left the item rebuilds carrying the failing check as a
// typed failure; with none left it goes to replanning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWorld, offer, startEvent, ISSUE, briefReturns, builderReturns, deliver, wake, checkRun, openRun, pending } from './world.js';

test('Q3: a red check on the head rebuilds with a typed failure; a second red check with no build left replans', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w);
    const a = await builderReturns(w);
    await deliver(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });
    const A = a.head;

    // A red check on another PR, or on another head, is not this item's.
    const [otherPr] = await wake(w, checkRun(A, 'o/r#9'));
    assert.notEqual(otherPr.outcome, 'applied');
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });

    await wake(w, checkRun(A, 'o/r#1', 'failure', 'test'));
    assert.equal(w.host.snapshot.value, 'building');
    assert.equal(openRun(w.host, 'verify'), null, 'the verify run was stopped');
    const rebuild = openRun(w.host, 'build');
    assert.deepEqual(rebuild.input.failure, { kind: 'check', check: 'test', conclusion: 'failure', sha: A, url: `https://github.com/o/r/actions/runs/1/job/${A.slice(0, 6)}` });

    const b = await builderReturns(w);
    assert.ok(b.got.accepted, JSON.stringify(b.got));
    await deliver(w);
    assert.equal(w.host.snapshot.context.builds, 2);
    await wake(w, checkRun(b.head, 'o/r#1', 'timed_out', 'test'));
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.equal(w.host.snapshot.context.builds, 2);
    assert.equal(w.host.snapshot.context.failure.kind, 'check');
    assert.equal(w.host.snapshot.context.failure.sha, b.head);
    const builds = [...w.host.effects.values()].filter((e) => e.effect.type === 'run' && e.effect.actor === 'build');
    assert.equal(builds.length, 2, 'no third build started');
    assert.equal(openRun(w.host, 'build'), null);
    assert.ok(openRun(w.host, 'ask'), 'the replan card is up');
    assert.equal(w.gh.merges.length, 0);
  } finally {
    await w.close();
  }
});
