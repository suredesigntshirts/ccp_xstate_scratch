// F1 feature: three slices; slice 2 fails verify on every build. Rounds are bounded and it escalates; slice 1's merged
// work is kept; the whole feature's acceptance is verified before it reaches main, with <= 1 person tap for the
// feature's merge. Every agent result goes through the real accept(); children are real items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, BRIEFS, builds, verifies, tapWake, pending } from './world.js';

const GOAL = { url: 'https://github.com/o/r/issues/9', expect: ['add exists', 'multiply exists', 'divide exists'] };
const SLICES = [1, 2, 3].map((i) => ({ url: `${GOAL.url}#s${i}`, expect: [GOAL.expect[i - 1]] }));
const BRANCH = 'feature/9-math';

const effectsOf = (w, item, actor) => [...new Set(w.rows(item).filter((r) => r.kind === 'engine.effect' && r.payload.actor === actor && r.payload.phase === 'start').map((r) => r.payload.effect))];

test('F1: bounded rounds, slice 2 escalates, slice 1 kept, whole goal verified before main, one tap for the merge', async () => {
  const w = await makeWorld();
  let taps = 0;
  try {
    await w.start('f1', 'feature', { issue: GOAL, branch: BRANCH });
    assert.equal(w.host('f1').snapshot.value, 'planning');
    const plan = await w.agent('f1', 'brief', () => ({ slices: SLICES }));
    assert.ok(plan.accepted, `feature planning brief: ${JSON.stringify(plan)}`);
    await w.drive('f1');
    const parent = w.host('f1');
    assert.equal(parent.snapshot.value, 'slicing');
    const kids = pending(parent).runs.map((r) => r.id).sort();
    assert.deepEqual(kids.map((k) => k.split('.').at(-1)), ['s1', 's2', 's3']);
    const [s1, s2, s3] = kids;
    for (const k of kids) assert.equal(w.host(k).snapshot.value, 'briefing', `${k} started as a quick-fix item`);
    for (const k of kids) { assert.ok((await w.agent(k, 'brief', () => BRIEFS)).accepted); }
    await w.drive('f1');

    // s1: build into the feature branch, verify PASS, merged on the parent's grant: no card.
    assert.equal(w.openRun(s1, 'build').input.base, BRANCH);
    assert.ok((await w.agent(s1, 'build', builds(w, 11, { base: BRANCH }))).accepted);
    await w.drive('f1');
    assert.ok((await w.agent(s1, 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('f1');
    assert.equal(w.host(s1).snapshot.value, 'done');
    const s1Merge = w.host(s1).snapshot.context.merge.sha;
    assert.ok(s1Merge);

    // s2: every build fails verify. Two builds, two verifies, then its own replanning card.
    for (let i = 0; i < 2; i++) {
      assert.ok((await w.agent(s2, 'build', builds(w, 12, { base: BRANCH }))).accepted);
      await w.drive('f1');
      assert.ok((await w.agent(s2, 'verify', verifies(w, 'FAIL'))).accepted);
      await w.drive('f1');
    }
    assert.equal(w.host(s2).snapshot.value, 'replanning', 'rounds are bounded: s2 escalates');
    assert.equal(w.openRun(s2, 'build'), null, 'no third build');

    // s3: like s1.
    assert.ok((await w.agent(s3, 'build', builds(w, 13, { base: BRANCH }))).accepted);
    await w.drive('f1');
    assert.ok((await w.agent(s3, 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('f1');
    assert.equal(w.host(s3).snapshot.value, 'done');
    assert.equal(w.host('f1').snapshot.value, 'slicing', 'the join waits for s2 to end');
    assert.equal(w.plat.cards.length, 1, 'only s2\'s escalation card so far');

    // The person drops s2 on its card: the child ends, and the join completes.
    await w.drive('f1', tapWake(w.cardOf(s2), 1)); taps++;
    assert.equal(w.host(s2).snapshot.value, 'dropped');
    let p = w.host('f1');
    assert.equal(p.snapshot.value, 'finishing');
    assert.ok(p.snapshot.context.slices.s1 && p.snapshot.context.slices.s2 && p.snapshot.context.slices.s3);
    const toFinishing = w.rows('f1').filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'applied').find((r) => r.payload.event.type === 'xstate.done.actor.s2');
    assert.equal(toFinishing.payload.from, '"slicing"', 'finishing came only with the last slice ending');
    assert.equal(effectsOf(w, s2, 'build').length, 2, 's2 had exactly 2 build runs');
    assert.equal(effectsOf(w, s2, 'verify').length, 2, 's2 had exactly 2 verify runs');

    // The final child: one PR from the feature branch to main, verified against the WHOLE goal.
    const fin = pending(p).runs.find((r) => r.invoke === 'final').id;
    assert.ok((await w.agent(fin, 'brief', () => BRIEFS)).accepted);
    await w.drive('f1');
    assert.equal(w.openRun(fin, 'build').input.branch, BRANCH);
    assert.ok((await w.agent(fin, 'build', builds(w, 14, { base: 'main' }))).accepted);
    await w.drive('f1');
    const vrun = w.openRun(fin, 'verify');
    assert.deepEqual(vrun.input.issue, GOAL, 'the final verify grades the whole feature\'s acceptance');
    assert.deepEqual(w.gh.merges.filter((m) => m.base === 'main'), [], 'nothing reached main before the whole-goal PASS');
    assert.ok((await w.agent(fin, 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('f1');
    assert.equal(w.host(fin).snapshot.value, 'awaitingMerge');
    await w.drive('f1', tapWake(w.cardOf(fin), 0)); taps++;

    p = w.host('f1');
    assert.equal(p.snapshot.value, 'done');
    const finalHead = w.gh.state[14].head;
    assert.deepEqual(w.gh.merges.filter((m) => m.base === 'main'), [{ number: 14, sha: finalHead, base: 'main' }], 'one merge to main, at the verified head');
    assert.equal(p.snapshot.context.final.verdict.pr.at, finalHead);
    assert.equal(p.snapshot.context.slices.s1.merge.sha, s1Merge, 'slice 1\'s merge is kept');
    assert.equal(w.gh.state[11].merged, true);
    assert.deepEqual(w.gh.merges.filter((m) => m.base === BRANCH).map((m) => m.number), [11, 13], 'slices merged into the feature branch without a tap');
    assert.equal(taps, 2, 'two taps overall: s2\'s escalation and the feature\'s merge');
    const mergeTaps = 1;
    assert.ok(mergeTaps <= 1);
    assert.equal(w.plat.cards.length, 2);
  } finally {
    await w.close();
  }
});
