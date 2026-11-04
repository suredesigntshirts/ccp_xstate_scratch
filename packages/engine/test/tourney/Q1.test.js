// Q1 happy path: issue -> brief -> build -> verify PASS -> CI green -> person approves -> merged at the verified head.
// Real engine and real accept; GitHub, the thread and the agents' work are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, ISSUE, BRIEFS, builds, verifies, tapWake } from './world.js';

test('Q1: issue to merged at the verified head, with one person tap', async () => {
  const w = await makeWorld();
  try {
    await w.start('q1', 'quick-fix', { issue: ISSUE });
    assert.equal(w.host('q1').snapshot.value, 'briefing');
    assert.ok((await w.agent('q1', 'brief', () => BRIEFS)).accepted);
    await w.drive('q1');
    assert.equal(w.host('q1').snapshot.value, 'building');
    // The builder pushes; CI is not yet green at accept time, so the item waits in checking for the suite.
    const b = await w.agent('q1', 'build', builds(w, 1, { green: false }));
    assert.ok(b.accepted, JSON.stringify(b));
    await w.drive('q1');
    const head = w.gh.state[1].head;
    assert.equal(w.host('q1').snapshot.value, 'checking');
    assert.equal(w.host('q1').snapshot.context.pr.key, 'o/r#1', 'key stamped by the host');
    w.gh.green(head);
    const { suiteWake } = await import('./world.js');
    await w.drive('q1', suiteWake(head, 1));
    assert.equal(w.host('q1').snapshot.value, 'verifying');
    assert.ok((await w.agent('q1', 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('q1');
    assert.equal(w.host('q1').snapshot.value, 'awaitingMerge');
    assert.deepEqual(w.gh.merges, [], 'no merge before the person approves');
    assert.equal(w.plat.cards.length, 1);
    let taps = 0;
    await w.drive('q1', tapWake(w.cardOf('q1'), 0)); taps++;
    const end = w.host('q1').snapshot;
    assert.equal(end.value, 'done');
    assert.deepEqual(w.gh.merges, [{ number: 1, sha: head, base: 'main' }], 'merged once, at the verified head');
    assert.equal(end.context.verdict.pr.at, head);
    assert.equal(end.context.merge.sha, w.gh.state[1].mergeSha);
    assert.equal(taps, 1);
    assert.equal(w.plat.cards.length, 1, 'one card on the happy path');
  } finally {
    await w.close();
  }
});
