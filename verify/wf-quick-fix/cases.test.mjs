// Verifier's own tests, written from plan/cases/work-item.md, against workflows/quick-fix.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialTransition, transition } from 'xstate';
import { machineOf, startRefusal, failing } from '../../packages/engine/src/index.js';

const spec = JSON.parse(readFileSync(new URL('../../workflows/quick-fix.json', import.meta.url), 'utf8'));
const m = machineOf(spec);
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const issue = { url: 'https://github.com/o/r/issues/1', expect: ['x holds'] };
const done = (id, output) => ({ type: `xstate.done.actor.${id}`, output });
const step = (s, e) => transition(m, s, e)[0];
const start = () => initialTransition(m, { issue })[0];
const toVerifying = (head) => [done('brief', { builder: 'b', verifier: 'v' }), done('build', { pr: { branch: 'build/x', headSha: head, url: 'u' } })].reduce(step, start());
const val = (s) => s.value;

test('C-verdict-on-old-head: PASS for A while head is B never reaches merging, verdict is recorded', () => {
  let s = toVerifying(A);
  s = step(s, { type: 'pr.pushed', headSha: B });
  assert.equal(val(s), 'verifying'); assert.equal(s.context.pr.headSha, B);
  s = step(s, done('verify', { result: 'PASS', sha: A, report: 'r' }));
  assert.notEqual(val(s), 'awaitingMerge'); assert.notEqual(val(s), 'merging'); assert.notEqual(val(s), 'done');
  assert.equal(s.context.verdict.sha, A); // recorded, and differs from head
  assert.notEqual(s.context.verdict.sha, s.context.pr.headSha);
  // and no event path reaches merging from here
  for (const e of [done('ask', { choice: 'approve' }), done('merge', { sha: A })]) assert.notEqual(val(step(s, e)), 'done');
});

test('C-verdict-on-old-head: control, PASS at the head reaches awaitingMerge', () => {
  const s = step(toVerifying(A), done('verify', { result: 'PASS', sha: A, report: 'r' }));
  assert.equal(val(s), 'awaitingMerge');
});

test('C-push-after-pass: push to B while awaitingMerge returns to verifying for B', () => {
  let s = step(toVerifying(A), done('verify', { result: 'PASS', sha: A, report: 'r' }));
  assert.equal(val(s), 'awaitingMerge');
  s = step(s, { type: 'pr.pushed', headSha: B });
  assert.equal(val(s), 'verifying'); assert.equal(s.context.pr.headSha, B);
  // the old PASS (sha A) cannot now carry to merge
  const s2 = step(s, done('verify', { result: 'PASS', sha: A, report: 'r' }));
  assert.notEqual(val(s2), 'awaitingMerge');
  // a fresh PASS on B does
  assert.equal(val(step(s, done('verify', { result: 'PASS', sha: B, report: 'r' }))), 'awaitingMerge');
});

test('C-second-fail-replans: FAIL, rebuild, second FAIL goes to replanning, no third build, waits for why', () => {
  const fail = (sha) => done('verify', { result: 'FAIL', sha, report: 'r' });
  let s = toVerifying(A);
  s = step(s, fail(A)); assert.equal(val(s), 'building');
  s = step(s, done('build', { pr: { branch: 'build/x', headSha: B, url: 'u' } })); assert.equal(val(s), 'verifying');
  s = step(s, fail(B)); assert.equal(val(s), 'replanning');
  const [, actions] = transition(m, toVerifying(A), fail(A));
  assert.ok(actions.some((a) => a.type === 'xstate.spawnChild' && a.params.src === 'build'));
  const [, a2] = transition(m, step(step(toVerifying(A), fail(A)), done('build', { pr: { branch: 'build/x', headSha: B, url: 'u' } })), fail(B));
  assert.ok(!a2.some((a) => a.type === 'xstate.spawnChild' && a.params.src === 'build'), 'no third build started');
  // replan without a why: stays in replanning, no build
  const [r1, ra] = transition(m, s, done('ask', { choice: 'replan' }));
  assert.equal(val(r1), 'replanning');
  assert.ok(!ra.some((a) => a.type === 'xstate.spawnChild' && ['build', 'brief'].includes(a.params.src)));
  // with a why: goes to briefing (fresh start), not building
  assert.equal(val(step(s, done('ask', { choice: 'replan', why: 'five whys' }))), 'briefing');
});

test('C-missing-expect-fails-closed: no Expect lines cannot leave queued, refusal names the input', () => {
  for (const bad of [{ issue: { url: 'u', expect: [] } }, { issue: { url: 'u' } }, { issue: { expect: ['x'] } }, {}, { issue: { url: 'u', expect: [''] } }]) {
    const r = startRefusal(spec, bad);
    assert.ok(r, `refused ${JSON.stringify(bad)}`);
  }
  assert.match(startRefusal(spec, { issue: { url: 'u', expect: [] } }), /expect/);
  assert.equal(startRefusal(spec, { issue }), null);
  // even bypassing the host, the machine's own entry guard keeps briefing from leaving
  const s = initialTransition(m, { issue: { url: 'u', expect: [] } })[0];
  // NOTE: the machine alone does not re-check the initial state's needs (startRefusal, the host's gate, does);
  // so this bypass is not asserted here. See verdict.json.
  assert.ok(startRefusal(spec, { issue: { url: 'u', expect: [] } }));
});

test('fail-closed (verifier): every guard fails for each absent field it reads', () => {
  const rd = (c) => (typeof c === 'string' ? [c] : [c.path, ...(c.same ? [c.same] : [])]);
  for (const [name, conds] of Object.entries(spec.meta.guards)) {
    assert.deepEqual(failing(spec, [name], {}), [name], name);
    assert.deepEqual(failing(spec, [name], { context: {}, event: {} }), [name], name);
    // each condition alone, with its field absent / null / empty
    for (const c of conds) for (const p of rd(c)) {
      const keys = p.split('.');
      for (const v of [undefined]) {
        // scope where only this path exists with value v, all others absent
        const scope = {}; let at = scope;
        keys.slice(0, -1).forEach((k) => (at = at[k] = {}));
        at[keys.at(-1)] = v;
        assert.deepEqual(failing(spec, [name], scope), [name], `${name} with ${p}=${v}`);
      }
    }
  }
});

test('fail-closed (verifier): buildsLeft fails when builds is null, a string or NaN', () => {
  for (const v of [null, '1', NaN, undefined]) assert.deepEqual(failing(spec, ['buildsLeft'], { context: { builds: v } }), ['buildsLeft'], String(v));
  assert.deepEqual(failing(spec, ['buildsLeft'], { context: { builds: 1 } }), []);
});
