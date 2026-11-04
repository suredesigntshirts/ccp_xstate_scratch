// Q3 red CI: a required check fails on the head; with a build left the item rebuilds carrying the failing check as a
// typed failure; with none left it goes to replanning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, ISSUE, BRIEFS, builds, redWake, tapWake } from './world.js';

test('Q3: red on the head rebuilds with the typed failure; red again with no build left replans; no verify for a red head', async () => {
  const w = await makeWorld();
  try {
    await w.start('q3', 'quick-fix', { issue: ISSUE });
    assert.ok((await w.agent('q3', 'brief', () => BRIEFS)).accepted);
    await w.drive('q3');
    assert.ok((await w.agent('q3', 'build', builds(w, 1, { green: false }))).accepted);
    await w.drive('q3');
    assert.equal(w.host('q3').snapshot.value, 'checking');
    const A = w.gh.state[1].head;
    await w.drive('q3', redWake(A, 1, 'test'));
    let h = w.host('q3');
    assert.equal(h.snapshot.value, 'building');
    const build2 = w.openRun('q3', 'build');
    assert.deepEqual(build2.input.failure, { check: 'test', conclusion: 'failure', sha: A, url: `https://ci/test/${A}` }, 'the rebuild carries the failing check, typed');
    assert.equal(build2.input.previous.at, A);
    assert.ok((await w.agent('q3', 'build', builds(w, 1, { green: false }))).accepted);
    await w.drive('q3');
    const B = w.gh.state[1].head;
    assert.notEqual(A, B);
    assert.equal(w.host('q3').snapshot.value, 'checking');
    await w.drive('q3', redWake(B, 1, 'test'));
    h = w.host('q3');
    assert.equal(h.snapshot.value, 'replanning', 'no build left: replanning');
    assert.deepEqual([h.snapshot.context.built, h.snapshot.context.rebuilt], [true, true], "both builds used");
    assert.equal(h.snapshot.context.failure.check, 'test');
    const verifyRuns = w.rows('q3').filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'verify');
    assert.equal(verifyRuns.length, 0, 'no verify run starts for a red head');
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});

// Round 2: replanning no longer re-asks itself with `reenter`. A replan answer without a written why matches no
// candidate, so it is refused; the ask run stays open, and an answer that carries the why is taken.
test('Q3 (round 2, no reenter): a replan tap without a why is refused and the item keeps waiting; a replan with a why rebuilds from scratch', async () => {
  const { offer, pending } = await import('./world.js');
  const w = await makeWorld();
  try {
    await w.start('q3r', 'quick-fix', { issue: ISSUE });
    assert.ok((await w.agent('q3r', 'brief', () => BRIEFS)).accepted);
    await w.drive('q3r');
    for (let i = 0; i < 2; i++) {
      assert.ok((await w.agent('q3r', 'build', builds(w, 1, { green: false }), `ag-b${i}`)).accepted);
      await w.drive('q3r');
      await w.drive('q3r', redWake(w.gh.state[1].head, 1, 'test'));
    }
    assert.equal(w.host('q3r').snapshot.value, 'replanning');
    const card = w.cardOf('q3r');
    await w.drive('q3r', tapWake(card, 0)); // "replan", but a tap carries no text
    let h = w.host('q3r');
    assert.equal(h.snapshot.value, 'replanning');
    const refused = w.rows('q3r').filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'refused').at(-1);
    assert.match(refused.payload.reason, /is not taken in "replanning"/);
    const ask = pending(h).runs.find((r) => r.actor === 'ask');
    assert.ok(ask, 'the ask run is still open');
    await offer(h, [{ event: { type: `xstate.done.actor.${ask.invoke}`, output: { choice: 'replan', by: 'person', why: 'five whys: CI needs node 22' } }, run: ask.id, source: { system: 'hearth', ref: `${card}:typed` } }], w.handlersFor(h));
    h = w.host('q3r');
    assert.equal(h.snapshot.value, 'briefing');
    assert.deepEqual([h.snapshot.context.built, h.snapshot.context.rebuilt], [null, null], 'the build bound is reset');
  } finally {
    await w.close();
  }
});
