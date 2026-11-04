// F1 Feature: three slices, slice 2 fails verify on every build: rounds are bounded and it escalates; slice 1's
// merged work is kept; the whole feature's acceptance is verified before it reaches main, with <= 1 person tap for
// the feature's merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { A, B, C, D, X, world, fakeGitHub, fileExists, replanWithWhy, openRunOf } from './world.js';
import { GOAL, SLICES, feature, planned, built, verified, passingSlice, tapsIn, tap } from './feature-helpers.js';

const allItems = (root) => readdirSync(join(root, 'items')).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6));
const merged = (gh) => gh.merges.map(({ number, sha, base }) => ({ number, sha, base }));

test('F1-A escalation: slice 2 fails verify on both builds, escalates to its card; drop ends the join with slice 1 kept and nothing on main', async () => {
  const gh = await fakeGitHub({});
  try {
    const w = world({ gh });
    const { child } = await planned(w);
    assert.deepEqual(w.open(child(0)).snapshot.context.facts.input.v, { issue: SLICES[0], base: 'feature/x' });
    await passingSlice(w, child(0), 11, A, gh);
    assert.equal(w.plat.cards.length, 0, 'slice 1 merged with no card');

    let adv = await w.advance('f-1', feature());
    assert.deepEqual(adv.inputs, [], 'the join is not complete');
    assert.ok(fileExists(w.root, child(1)), 'slice 2 starts once slice 1 is done');
    assert.ok(!fileExists(w.root, child(2)));

    gh.add(12, { head: B, branch: 'build/12', base: 'feature/x' });
    await built(w, child(1), 12, B, gh);
    let s2 = await verified(w, child(1), 12, B, 'FAIL', gh);
    assert.equal(s2.snapshot.value, 'building', 'one more round');
    gh.push(12, C);
    await built(w, child(1), 12, C, gh);
    s2 = await verified(w, child(1), 12, C, 'FAIL', gh);
    assert.equal(s2.snapshot.value, 'replanning', 'rounds are bounded: escalate');
    assert.equal(w.agents.started.filter((e) => e.actor === 'build' && e.id.startsWith(`${child(1)}:`)).length, 2, 'two builds, no third');
    assert.equal(w.plat.cards.length, 1);

    ({ host: s2 } = await w.send(child(1), tap(s2, 'replan', 1))); // drop
    assert.equal(s2.snapshot.value, 'dropped');

    adv = await w.advance('f-1', feature());
    assert.equal(adv.inputs.length, 1);
    const join_ = adv.inputs[0].event.output;
    assert.deepEqual([join_.total, join_.done], [3, 1]);
    assert.deepEqual(join_.items.map((i) => i.state), ['done', 'dropped', 'not-started']);
    assert.equal(adv.host.snapshot.value, 'replanning', 'the feature escalates');
    assert.ok(!fileExists(w.root, child(2)), 'slice 3 never started');
    assert.deepEqual(merged(gh), [{ number: 11, sha: A, base: 'feature/x' }], 'slice 1 is kept; nothing went to main');
  } finally {
    await gh.close();
  }
});

test('F1-B completion: slice 2 replanned and passing; all slices on feature/x; the goal is verified as one PR into main and merged on one tap', async () => {
  const gh = await fakeGitHub({});
  try {
    const w = world({ gh });
    const { child } = await planned(w);
    await passingSlice(w, child(0), 11, A, gh);
    await w.advance('f-1', feature());

    gh.add(12, { head: B, branch: 'build/12', base: 'feature/x' });
    await built(w, child(1), 12, B, gh);
    await verified(w, child(1), 12, B, 'FAIL', gh);
    gh.push(12, C);
    await built(w, child(1), 12, C, gh);
    let s2 = await verified(w, child(1), 12, C, 'FAIL', gh);
    assert.equal(s2.snapshot.value, 'replanning');
    ({ host: s2 } = await w.send(child(1), replanWithWhy(s2, 'five whys: divide by zero was never specified')));
    assert.equal(s2.snapshot.value, 'replanned');
    const attempt = `${openRunOf(s2, 'attempt').id.replace(':', '~')}.0`;
    assert.deepEqual(w.open(attempt).snapshot.context.facts.input.v.base, 'feature/x');

    gh.push(12, D);
    await built(w, attempt, 12, D, gh);
    assert.equal((await verified(w, attempt, 12, D, 'PASS', gh)).snapshot.value, 'done');
    assert.equal((await w.advance(child(1))).host.snapshot.value, 'done', 'slice 2 done through its attempt');
    await w.advance('f-1', feature());
    await passingSlice(w, child(2), 13, X, gh);
    let adv = await w.advance('f-1', feature());
    assert.deepEqual([adv.inputs[0].event.output.total, adv.inputs[0].event.output.done], [3, 3]);
    assert.equal(adv.host.snapshot.value, 'finishing');
    assert.equal(gh.merges.filter((m) => m.base === 'main').length, 0, 'nothing on main before the whole feature is verified');

    const final = `${openRunOf(adv.host, 'final').id.replace(':', '~')}.0`;
    assert.deepEqual(w.open(final).snapshot.context.facts.input.v, { issue: GOAL, from: 'feature/x' });
    const F = '1'.repeat(40);
    gh.add(14, { head: F, branch: 'feature/x', base: 'main' });
    await built(w, final, 14, F, gh);
    const goalVerify = w.agents.started.filter((e) => e.actor === 'verify' && e.id.startsWith(`${final}:`)).at(-1);
    assert.deepEqual(goalVerify.input.input.issue.expect, GOAL.expect, 'the final verify grades the goal\'s acceptance lines');
    let fin = await verified(w, final, 14, F, 'PASS', gh);
    assert.equal(fin.snapshot.value, 'awaitingMerge', 'into the default branch needs the person');
    assert.equal(gh.merges.filter((m) => m.base === 'main').length, 0);
    const cardsBefore = w.plat.cards.length;
    ({ host: fin } = await w.send(final, tap(fin, 'approval', 0)));
    assert.equal(fin.snapshot.value, 'done');
    assert.equal(w.plat.cards.length - cardsBefore, 0);
    adv = await w.advance('f-1', feature());
    assert.equal(adv.host.snapshot.value, 'done');

    assert.deepEqual(merged(gh), [
      { number: 11, sha: A, base: 'feature/x' },
      { number: 12, sha: D, base: 'feature/x' },
      { number: 13, sha: X, base: 'feature/x' },
      { number: 14, sha: F, base: 'main' }
    ]);
    const taps = tapsIn(w.root, allItems(w.root));
    assert.equal(taps, 2, 'one tap for the escalation (replan) and one for the feature\'s merge');
    const mergeTaps = tapsIn(w.root, [final]);
    assert.ok(mergeTaps <= 1, 'at most one tap for the feature\'s merge');
  } finally {
    await gh.close();
  }
});

test('F1-C a feature with no failing slice costs exactly one tap, for its merge into main', async () => {
  const gh = await fakeGitHub({});
  try {
    const w = world({ gh });
    const { child } = await planned(w);
    await passingSlice(w, child(0), 11, A, gh);
    await w.advance('f-1', feature());
    await passingSlice(w, child(1), 12, B, gh);
    await w.advance('f-1', feature());
    await passingSlice(w, child(2), 13, C, gh);
    const adv = await w.advance('f-1', feature());
    const final = `${openRunOf(adv.host, 'final').id.replace(':', '~')}.0`;
    gh.add(14, { head: D, branch: 'feature/x', base: 'main' });
    await built(w, final, 14, D, gh);
    let fin = await verified(w, final, 14, D, 'PASS', gh);
    ({ host: fin } = await w.send(final, tap(fin, 'approval', 0)));
    assert.equal((await w.advance('f-1', feature())).host.snapshot.value, 'done');
    assert.equal(tapsIn(w.root, allItems(w.root)), 1);
    assert.equal(w.plat.cards.length, 1);
  } finally {
    await gh.close();
  }
});
