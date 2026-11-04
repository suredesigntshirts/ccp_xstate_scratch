// F1 three slices; slice 2 (index 1) fails verify on every build: rounds are bounded and it escalates; slice 1's
// (index 0) merged work is kept; the whole feature's acceptance is verified before it reaches main, with <= 1 person
// tap for the feature's merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWorld, offer, startEvent, briefReturns, builderReturns, verifierReturns, deliver, wake, checkSuite, tap, writtenAnswer, openRun, git } from './world.js';

const ISSUE = { url: 'https://github.com/o/r/issues/8', expect: ['math.js exports add, sub and mul', 'each has a test'] };
const BRIEFS = { builder: 'Build the slice named by your input.', verifier: 'Check the slice named by your input, or the whole feature against expect.', slices: ['add', 'sub', 'mul'], count: 3 };
const file = (n) => ({ [`slice${n}.js`]: `export const s${n} = ${n};\n` });

test('F1: a failing slice escalates after two builds, slice 0 stays merged, and the feature is verified and merged to main with one merge tap', async () => {
  const w = await itemWorld({ workflow: 'feature' });
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w, BRIEFS);
    assert.equal(w.host.snapshot.value, 'building');

    // Slice 0: its own lane into the feature lane, verified, merged by the host with no tap.
    const s0 = await builderReturns(w, { files: file(0) });
    assert.ok(s0.got.accepted, JSON.stringify(s0.got));
    assert.equal(w.gh.prs[s0.number].branch, 'ccp/it-1/slice-0-attempt-1');
    assert.equal(w.gh.prs[s0.number].base, 'ccp/it-1/feature');
    await deliver(w);
    assert.equal(w.host.snapshot.value, 'verifying');
    await verifierReturns(w);
    await deliver(w);
    assert.equal(w.gh.prs[s0.number].merged, true);
    assert.deepEqual(w.gh.merges.map((m) => [m.number, m.sha, m.base]), [[1, s0.head, 'ccp/it-1/feature']]);
    assert.equal(w.plat.cards.length, 0, 'no tap for a slice');
    assert.equal(w.host.snapshot.value, 'building');
    assert.equal(w.host.snapshot.context.cursor.slice, 1);

    // Slice 1 fails verify on every build: two builds, then replanning (the escalation).
    for (let round = 1; round <= 2; round++) {
      const b = await builderReturns(w, { files: file(10 + round) });
      assert.ok(b.got.accepted, JSON.stringify(b.got));
      assert.equal(b.number, 2);
      await deliver(w);
      await verifierReturns(w, { result: 'FAIL' });
      await deliver(w);
    }
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.equal(w.host.snapshot.context.builds, 2);
    assert.equal(w.host.snapshot.context.cursor.slice, 1);
    assert.equal(w.host.snapshot.context.merge.head, s0.head, 'slice 0\'s merge is kept');
    assert.equal(w.gh.prs[1].merged, true);
    assert.equal([...w.host.effects.values()].filter((e) => e.effect.actor === 'build').length, 3, 'no third build of slice 1');
    assert.equal(w.plat.cards.length, 1, 'the escalation card');

    // The person replans with a written why: slice 1 again, on a fresh lane from the feature lane's tip.
    await writtenAnswer(w, { choice: 'replan', why: 'the slice was too big; split the test out' });
    assert.equal(w.host.snapshot.value, 'building');
    assert.deepEqual(w.host.snapshot.context.cursor, { slice: 1, attempt: 2 });
    const s1 = await builderReturns(w, { files: file(1) });
    assert.ok(s1.got.accepted, JSON.stringify(s1.got));
    assert.equal(w.gh.prs[s1.number].branch, 'ccp/it-1/slice-1-attempt-2');
    git(w.g.origin, 'merge-base', '--is-ancestor', s0.head, s1.head); // throws unless slice 0 is under slice 1's new work
    await deliver(w);
    await verifierReturns(w);
    await deliver(w);
    const s2 = await builderReturns(w, { files: file(2) });
    await deliver(w);
    await verifierReturns(w);
    await deliver(w);
    assert.equal(w.host.snapshot.value, 'integrating');
    assert.equal(w.host.snapshot.context.cursor.slice, 3);

    // One integration PR from the feature lane into main, verified against the feature's expect, CI green, one tap.
    const integ = await builderReturns(w, { name: 'integrate', files: {} });
    assert.ok(integ.got.accepted, JSON.stringify(integ.got));
    assert.equal(w.gh.prs[integ.number].branch, 'ccp/it-1/feature');
    assert.equal(w.gh.prs[integ.number].base, 'main');
    await deliver(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });
    const verify = openRun(w.host, 'verify');
    assert.deepEqual(verify.input.expect, ISSUE.expect, 'the whole feature is verified against its acceptance');
    assert.equal(verify.input.subject, integ.head);
    for (const s of [s0, s1, s2]) git(w.g.origin, 'merge-base', '--is-ancestor', s.head, integ.head);
    assert.equal(w.gh.merges.filter((m) => m.base === 'main').length, 0, 'nothing reached main before the feature verdict');
    await verifierReturns(w);
    await deliver(w);
    await wake(w, checkSuite(integ.head, `o/r#${integ.number}`));
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    await tap(w, 0);
    assert.equal(w.host.snapshot.value, 'done');

    const toMain = w.gh.merges.filter((m) => m.base === 'main');
    assert.deepEqual(toMain.map((m) => [m.number, m.sha]), [[integ.number, integ.head]], 'only the integration PR merged into main');
    const mergeTaps = w.plat.cards.filter((c) => /Merge this feature/.test(c.question)).length;
    assert.equal(mergeTaps, 1, 'one person tap for the feature\'s merge');
    assert.equal(w.plat.cards.length, 2, 'plus the one escalation the failing slice forced');
    const mainTip = git(w.g.origin, 'rev-parse', 'refs/heads/main');
    git(w.g.origin, 'merge-base', '--is-ancestor', s0.head, mainTip);
  } finally {
    await w.close();
  }
});
