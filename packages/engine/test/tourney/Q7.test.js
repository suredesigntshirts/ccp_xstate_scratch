// Q7 merge outside the host: the PR is merged on GitHub by someone else; the item must not end as verified-done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, ISSUE, BRIEFS, builds, verifies, tapWake, closedWake } from './world.js';

test('Q7: a merge on GitHub outside the host sends the item to replanning with mergedOutside; it ends dropped, never done', async () => {
  const w = await makeWorld();
  try {
    await w.start('q7', 'quick-fix', { issue: ISSUE });
    assert.ok((await w.agent('q7', 'brief', () => BRIEFS)).accepted);
    await w.drive('q7');
    assert.ok((await w.agent('q7', 'build', builds(w, 1))).accepted);
    await w.drive('q7');
    assert.ok((await w.agent('q7', 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('q7');
    assert.equal(w.host('q7').snapshot.value, 'awaitingMerge');
    const card = w.cardOf('q7');
    // Someone merges PR 1 on GitHub.
    w.gh.state[1].merged = true;
    await w.drive('q7', closedWake(1));
    let h = w.host('q7');
    assert.equal(h.snapshot.value, 'replanning');
    assert.deepEqual(h.snapshot.context.failure, { mergedOutside: 'o/r#1' });
    // The old approve card is closed: a tap on it moves nothing.
    await w.drive('q7', tapWake(card, 0));
    assert.equal(w.host('q7').snapshot.value, 'replanning');
    // The replanning card's "drop" (index 1).
    await w.drive('q7', tapWake(w.cardOf('q7'), 1));
    h = w.host('q7');
    assert.equal(h.snapshot.value, 'dropped');
    assert.equal(h.snapshot.context.merge, null);
    const states = w.rows('q7').filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'applied').map((r) => r.payload.from);
    assert.ok(!states.includes('"done"'), 'never done');
    assert.equal(w.rows('q7').filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge').length, 0, 'the host made no merge');
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});
