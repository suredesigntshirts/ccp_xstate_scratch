// F1 three slices; slice 2 fails verify on every build: rounds are bounded and it escalates; slice 1's merged work is
// kept; the whole feature's acceptance is verified before it reaches main, with <= 1 person tap for the feature's merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agents, fakeGitHub, fresh, loadWorkflow, offer, open, platform, prOf, start, statesOf, suite, tap, world, written } from './world-b.js';

const spec = loadWorkflow('feature');
const GOAL = { url: 'https://github.com/o/r/issues/9', expect: ['the CLI has a --json flag', 'the README documents --json'] };
const h = (c) => c.repeat(40);
const [F0, A, B, C, D, E] = ['0', 'a', 'b', 'c', '1', '2'].map(h);
const FB = 'feature/it-1';
const featurePr = (headSha) => prOf(10, headSha, FB);
const slicePr = (n, headSha) => prOf(n, headSha, `slice/${n}`);
const plan = (feature, expect) => ({ done: false, feature, builder: `build ${expect[0]}`, verifier: `grade ${expect[0]}`, expect });
const V = (result, sha) => ({ result, sha, ciChanged: false, report: 'r' });

test('F1: slice 2 escalates after two failed builds, slice 1 stays merged, and the feature is verified on its acceptance before one tap merges it to main', async () => {
  const gh = await fakeGitHub({
    10: { head: F0, branch: FB, base: 'main' },
    11: { head: A, branch: 'slice/11', base: FB },
    12: { head: B, branch: 'slice/12', base: FB },
    13: { head: D, branch: 'slice/13', base: FB },
    14: { head: E, branch: 'slice/14', base: FB }
  });
  try {
    const plat = platform();
    const root = fresh('f1');
    const host = open(root, spec);
    // Each planner output claims the feature PR as GitHub has it at that moment (a stub of the planner's look).
    const brief = [];
    const a = agents({
      build: [{ pr: slicePr(11, A) }, { pr: slicePr(12, B) }, { pr: slicePr(12, C) }, { pr: slicePr(13, D) }, { pr: slicePr(14, E) }],
      verify: [V('PASS', A), V('FAIL', B), V('FAIL', C), V('PASS', D), V('PASS', E), null]
    });
    const planner = { start: async (effect) => { a.started.push(effect); const next = brief.shift(); return next ? { ref: effect.id, output: next() } : { ref: effect.id }; } };
    const fx = world({ gh, plat, actors: { ...a.byActor, brief: planner } });
    const now = () => featurePr(gh.state[10].head);
    brief.push(() => plan(now(), ['slice 1: parse --json']));
    await offer(host, [start({ goal: GOAL })], fx);
    assert.equal(host.snapshot.value, 'waitingCi');

    // Slice 1: CI green, merged into the feature branch with no card.
    brief.push(() => plan(now(), ['slice 2: print JSON']));
    gh.push(12, B);
    const pushC = () => gh.push(12, C);
    await offer(host, suite(host, A), fx);
    const F1sha = gh.state[11].mergeSha;
    assert.ok(F1sha, 'slice 1 merged');
    assert.equal(gh.state[10].head, F1sha, 'the feature branch carries slice 1');
    pushC();
    // Slice 2: FAIL, rebuild, FAIL: the bound is reached and it escalates to the person.
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(host.snapshot.context.builds, 2, 'two builds of slice 2, no third');
    assert.equal(a.started.filter((e) => e.actor === 'build').length, 3);
    assert.equal(host.snapshot.context.feature.headSha, F1sha, 'slice 1 kept');
    assert.equal(gh.state[11].merged, true);
    assert.equal(plat.cards.length, 1);
    assert.deepEqual(plat.cards[0].choices, ['replan', 'drop']);

    // The person answers the escalation in words; the planner replans slice 2, then slice 3, then says done.
    brief.push(() => plan(now(), ['slice 2 again: print JSON via a serializer']));
    await offer(host, written(host, { choice: 'replan', why: 'five whys: slice 2 was too big' }), fx);
    assert.equal(host.snapshot.value, 'waitingCi');
    assert.equal(host.snapshot.context.feature.headSha, F1sha);
    brief.push(() => plan(now(), ['slice 3: document --json']));
    await offer(host, suite(host, D), fx);
    assert.equal(host.snapshot.value, 'waitingCi');
    let G = null;
    brief.push(() => { G = gh.state[10].head; return { done: true, feature: now(), verifier: 'grade the whole goal' }; });
    await offer(host, suite(host, E), fx);
    assert.equal(host.snapshot.value, 'verifying');
    assert.equal(host.snapshot.context.phase, 'final');
    const finalVerify = a.started.filter((e) => e.actor === 'verify').at(-1);
    assert.deepEqual(finalVerify.input.expect, GOAL.expect, 'the final verify grades the goal\'s acceptance');
    assert.equal(finalVerify.input.url, featurePr(G).url);
    assert.equal(finalVerify.input.headSha, G, 'at the feature head carrying all three slices');
    assert.equal(gh.merges.filter((m) => m.base === 'main').length, 0, 'nothing reached main before the whole-feature verdict');

    await offer(host, [{ event: { type: 'xstate.done.actor.verify', output: V('PASS', G) }, run: finalVerify.id, source: { system: 'harness', ref: 'final' } }], fx);
    assert.equal(host.snapshot.value, 'waitingCi');
    await offer(host, suite(host, G), fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');
    assert.equal(plat.cards.length, 2, 'the escalation card and one merge card');
    await offer(host, tap(host, 0), fx);
    assert.equal(host.snapshot.value, 'done');

    const toMain = gh.merges.filter((m) => m.base === 'main');
    const toFeature = gh.merges.filter((m) => m.base === FB);
    assert.deepEqual(toFeature.map((m) => m.number), [11, 13, 14], 'three slice merges into the feature branch, no tap each');
    assert.deepEqual(toMain.map(({ number, sha }) => ({ number, sha })), [{ number: 10, sha: G }], 'one merge into main at the verified feature head');
    const states = statesOf(root);
    assert.ok(states.indexOf('awaitingMerge') > states.lastIndexOf('verifying'));
    // Person interactions: 1 tap for the feature's merge, plus 1 written answer to the escalation.
    assert.equal(plat.cards.filter((c) => c.choices.includes('approve')).length, 1);
  } finally {
    await gh.close();
  }
});
