// Verifier's own tests for engine-host, from plan/cases/work-item.md: C-duplicate-wake-no-double-effect,
// C-stale-completion-dropped, C-refused-action-not-retried. Written against the public functions of the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { restore, offer, applyEvent, persist, inputsOfWake, itemFile, hashOf, loadWorkflow } from '../../packages/engine/src/index.js';
import { readFile } from '../../packages/journal/src/index.js';

const wake = (n) => readFileSync(new URL(`../../packages/engine/test/fixtures/wakes/${n}.txt`, import.meta.url), 'utf8');
const dir = () => mkdtempSync(join(tmpdir(), 'v-engine-host-'));
const RELEASE = '0.2.0';
const open = (root, spec, session = 'S-owner') => restore({ root, item: 'v-1', spec, session, release: RELEASE });
const rows = (root) => readFile(itemFile(root, 'v-1')).rows;
const init = (input = {}) => ({ event: { type: 'xstate.init', input }, source: { system: 'claude-code', ref: 'S-owner' } });
const SHA = (c) => c.repeat(40);

// Own workflow: waits for a GitHub check_run event, then runs a "merge" actor once.
const mergeSpec = {
  id: 'verifier-merge', initial: 'waiting', context: {},
  states: {
    waiting: { on: { 'github.check_run.completed': 'merging' } },
    merging: { invoke: { id: 'merge', src: 'merge', input: {}, onDone: 'done', onError: 'failed' } },
    failed: { type: 'final' }, done: { type: 'final' }
  },
  meta: { guards: {}, input: { type: 'object' }, events: { 'github.check_run.completed': { type: 'object' } }, actors: { merge: { type: 'object' } }, schemas: {} }
};

test('duplicate (a): same GitHub wake delivered twice in one hook and again after restart -> effect once', async () => {
  const root = dir();
  const sideEffects = [];
  const handlers = { run: { start: async (e) => { sideEffects.push(e.id); return { ref: 'm1' }; } } };
  let host = open(root, mergeSpec);
  await offer(host, [init()], handlers);
  const twice = wake('check-run-failed') + '\n' + wake('check-run-failed');
  const inputs = inputsOfWake(host, twice);
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0].source, inputs[1].source, 'redelivery has the same source');
  const res = await offer(host, inputs, handlers);
  assert.deepEqual(res.map((r) => r.outcome), ['applied', 'duplicate']);
  // later delivery to a restarted host
  host = open(root, mergeSpec);
  const again = await offer(host, inputsOfWake(host, wake('check-run-failed')), handlers);
  assert.deepEqual(again.map((r) => r.outcome), ['duplicate']);
  assert.equal(sideEffects.length, 1);
  const effectRows = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.type === 'run');
  assert.deepEqual(effectRows.map((r) => r.payload.phase), ['start', 'done']);
  const trans = rows(root).filter((r) => r.kind === 'engine.transition');
  assert.equal(trans.filter((r) => r.payload.outcome === 'applied').length, 2); // init + github
  assert.equal(trans.filter((r) => r.payload.outcome === 'duplicate').length, 2);
  // a different GitHub event is not a duplicate
  const other = inputsOfWake(host, wake('check-suite-completed'));
  assert.notDeepEqual(other[0]?.source, inputs[0].source);
});

test('duplicate (b): process dies mid-effect (real child, exit 9); restart does not repeat the side effect', async () => {
  const root = dir();
  const log = join(root, 'side-effects.log');
  const specFile = join(root, 'spec.json');
  writeFileSync(specFile, JSON.stringify(mergeSpec));
  let host = open(root, mergeSpec);
  await offer(host, [init(), ...inputsOfWake(host, wake('check-run-failed'))], {}); // no handlers: effect stays pending
  const child = spawnSync('node', [new URL('./crash-child.mjs', import.meta.url).pathname, root, specFile, log]);
  assert.equal(child.status, 9, child.stderr?.toString());
  assert.equal(readFileSync(log, 'utf8'), 'MERGED\n');
  const phases = () => rows(root).filter((r) => r.kind === 'engine.effect').map((r) => r.payload.phase);
  assert.deepEqual(phases(), ['start']);
  // Restart with a handler that would merge again (no find): must not.
  let again = 0;
  host = open(root, mergeSpec);
  await offer(host, [], { run: { start: async () => { again += 1; return {}; } } });
  host = open(root, mergeSpec);
  await offer(host, [], { run: { start: async () => { again += 1; return {}; } } });
  assert.equal(again, 0);
  assert.deepEqual(phases(), ['start', 'unknown']);
  // With find() that reports it happened: completes without a second start.
  const root2 = dir();
  host = open(root2, mergeSpec);
  await offer(host, [init(), ...inputsOfWake(host, wake('check-run-failed'))], {});
  const [eff] = [...host.effects.values()];
  persist(host, { file: host.file, kind: 'engine.effect', source: { system: 'engine', ref: eff.effect.id }, session: 'S-owner', item: 'v-1', state: null, release: RELEASE,
    payload: { effect: eff.effect.id, type: 'run', phase: 'start', transition: eff.effect.transition, outcome: null, rule: null, reason: null } });
  let starts = 0;
  host = open(root2, mergeSpec);
  await offer(host, [], { run: { start: async () => { starts += 1; return {}; }, find: async () => ({ ref: 'm1', output: {} }) } });
  assert.equal(starts, 0);
  assert.equal(host.snapshot.value, 'done');
});

const qf = loadWorkflow('quick-fix');
const BR = { builder: 'b.md', verifier: 'v.md' };
const prOut = (h) => ({ pr: { branch: 'build/x', headSha: h, url: 'https://github.com/o/r/pull/1' } });
const quickStart = { event: { type: 'xstate.init', input: { issue: { url: 'https://github.com/o/r/issues/1', expect: ['x'] } } }, source: { system: 'claude-code', ref: 'S-owner' } };

test('stale: completion from a replaced run is journalled stale and changes nothing (also across restart, forged run id)', async () => {
  const root = dir();
  const handlers = { run: { start: async (e) => ({ ref: `r-${e.id}`, ...(e.actor === 'brief' ? { output: BR } : e.actor === 'build' ? { output: prOut(SHA('a')) } : {}) }) } };
  const host = open(root, qf);
  await offer(host, [quickStart], handlers);
  assert.equal(host.snapshot.value, 'verifying');
  const oldRun = [...host.effects.values()].find((e) => e.effect.actor === 'verify').effect.id;
  const [pushed] = await offer(host, [{ event: { type: 'pr.pushed', headSha: SHA('b') }, source: { system: 'github', ref: 'push-b' } }], handlers);
  assert.equal(pushed.outcome, 'applied');
  const newRun = [...host.runs.values()].find((r) => r.actor === 'verify').id;
  assert.notEqual(newRun, oldRun);
  const before = hashOf(host.snapshot);
  const nRows = rows(root).length;
  const passA = { type: 'xstate.done.actor.verify', output: { result: 'PASS', sha: SHA('a'), report: 'r' } };
  for (const h of [host, open(root, qf)]) {
    const [r] = await offer(h, [{ event: passA, run: oldRun, source: { system: 'engine', ref: `old-${Math.random()}` } }], handlers);
    assert.equal(r.outcome, 'stale');
    assert.equal(hashOf(h.snapshot), before);
    assert.equal(h.snapshot.value, 'verifying');
  }
  // Completion naming no run at all, or a run that never existed: stale too.
  const [none] = await offer(host, [{ event: passA, source: { system: 'engine', ref: 'norun' } }], handlers);
  assert.equal(none.outcome, 'stale');
  const [fake] = await offer(host, [{ event: passA, run: 'v-1:99.verify', source: { system: 'engine', ref: 'fake' } }], handlers);
  assert.equal(fake.outcome, 'stale');
  const t = rows(root).filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'stale');
  assert.equal(t.length, 4);
  assert.ok(t.every((r) => r.payload.transition === null && /not in flight/.test(r.payload.reason)));
  assert.equal(hashOf(open(root, qf).snapshot), before);
  assert.ok(rows(root).length > nRows); // journalled
  // The current run's completion still works.
  const [good] = await offer(host, [{ event: { ...passA, output: { ...passA.output, sha: SHA('b') } }, run: newRun, source: { system: 'engine', ref: 'new' } }], handlers);
  assert.equal(good.outcome, 'applied');
  assert.equal(host.snapshot.value, 'awaitingMerge');
});

test('refused-effect: refusal journalled with rule, not retried (same host, restarted host, repeated wakes); item steps back', async () => {
  const root = dir();
  let builds = 0;
  const handlers = { run: { start: async (e) => {
    if (e.actor === 'brief') return { output: BR };
    if (e.actor !== 'build') return { ref: 'card' }; // replanning's ask: waits for a person
    builds += 1;
    return { refused: { rule: 'auto-mode: Self-Modification', text: 'blocked' } };
  } } };
  const host = open(root, qf);
  await offer(host, [quickStart], handlers);
  assert.equal(builds, 1);
  assert.equal(host.snapshot.value, 'replanning');
  assert.match(host.snapshot.context.failure, /auto-mode: Self-Modification/);
  for (let i = 0; i < 3; i++) await offer(open(root, qf), [], handlers);
  await offer(host, [], handlers);
  assert.equal(builds, 1);
  const refused = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.phase === 'refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].payload.rule, 'auto-mode: Self-Modification');
  assert.equal(refused[0].payload.effect, 'v-1:1.build');
  // thrown error is also not retried
  const root2 = dir();
  let throws = 0;
  const h2 = open(root2, qf);
  const bad = { run: { start: async (e) => { if (e.actor === 'brief') return { output: BR }; if (e.actor !== 'build') return {}; throws += 1; throw new Error('boom'); } } };
  await offer(h2, [quickStart], bad);
  await offer(open(root2, qf), [], bad);
  assert.equal(throws, 1);
  assert.equal(open(root2, qf).snapshot.value, 'replanning');
});

test('replay (extra): restored snapshot hash equals the live one', async () => {
  const root = dir();
  const handlers = { run: { start: async (e) => ({ ref: e.id, ...(e.actor === 'brief' ? { output: BR } : e.actor === 'build' ? { output: prOut(SHA('a')) } : {}) }) } };
  const host = open(root, qf);
  await offer(host, [quickStart, { event: { type: 'pr.pushed', headSha: SHA('c') }, source: { system: 'github', ref: 'p' } }], handlers);
  const back = open(root, qf);
  assert.equal(hashOf(back.snapshot), hashOf(host.snapshot));
  assert.deepEqual(back.snapshot.context, host.snapshot.context);
});
