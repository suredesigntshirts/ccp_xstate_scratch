// P1 Missing part refuses to load (stage contract, lane M): a workflow whose model stage lacks a required part throws
// at load, on the plain path and on the pinned path; the three repo workflows load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
import { handlers } from '../../src/effects/index.js';
import { fresh } from './world.js';
import { workflow } from './contract.js';

const broken = (change) => { const wf = workflow('quick-fix'); change(wf); return wf; };
const dirWith = (wf, extra = {}) => {
  const dir = fresh('p1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'quick-fix.json'), JSON.stringify(wf, null, 2));
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(dir, `${name}.json`), body);
  return dir;
};

const CASES = [
  ['an input with no meaning', (wf) => { delete wf.meta.stages.build.verdict; }, /building: input verdict of stage build has no meaning/],
  ['a stage with no rules', (wf) => { delete wf.meta.stages.verify.task; }, /stage verify has no rules: meta\.stages\.verify\.task is missing or empty/],
  ['empty rules', (wf) => { wf.meta.stages.brief.task = []; }, /stage brief has no rules/],
  ['an empty meaning', (wf) => { wf.meta.stages.build.base = ''; }, /stage build: base has no meaning/],
  ['an invoke with no task', (wf) => { delete wf.states.building.invoke.input.task; }, /building: meta\.stages\.build\.task has words for task, which this invoke does not give/],
  ['a meaning for an input the invoke does not give', (wf) => { wf.meta.stages.build.extra = 'not given'; }, /meta\.stages\.build\.extra has words for extra, which this invoke does not give/],
  ['a stage with its whole entry deleted', (wf) => { delete wf.meta.stages.build; }, /building: build is not a stage, a host effect or a workflow/],
  ['a stage with no output', (wf) => { delete wf.meta.actors.verify; }, /stage verify has no output: meta\.actors\.verify is missing/],
  ['a verify invoke that does not give the lines it grades', (wf) => { delete wf.states.verifying.invoke.input.lines; }, /verifying: meta\.stages\.verify\.lines has words for lines, which this invoke does not give/]
];

for (const [name, change, message] of CASES) {
  test(`P1: ${name} refuses to load`, () => {
    const dir = dirWith(broken(change));
    assert.throws(() => loadWorkflow('quick-fix', { dir }), (e) => /^workflow quick-fix refuses to load: /.test(e.message) && message.test(e.message));
  });
}

test('P1 (round 2): a workflow file named like a stage changes nothing: the load reads no collision, and the stage runs', async () => {
  const dir = dirWith(workflow('quick-fix'), { build: '{}' });
  assert.ok(loadWorkflow('quick-fix', { dir }).meta.stages.build, 'quick-fix still loads beside a build.json');
  const started = [];
  const h = handlers({ actors: { build: { start: (e) => { started.push(e.actor); return { ref: 'stage' }; } } }, host: {}, handlersFor: () => ({}), workflows: ['build'] });
  assert.deepEqual(await h.run.start({ actor: 'build', id: 'x:1.build' }), { ref: 'stage' });
  assert.deepEqual(started, ['build'], 'the stage handler runs, not a child item of the build workflow');
});

test('P1 (round 2): a pinned workflow loads from its blob alone: a new workflow file named like one of its stages does not refuse it', () => {
  const root = fresh('p1pin');
  const dir = fresh('p1pindir');
  mkdirSync(dir, { recursive: true });
  for (const n of ['research', 'quick-fix', 'feature']) writeFileSync(join(dir, `${n}.json`), JSON.stringify(workflow(n), null, 2));
  const pinned = loadWorkflow('research', { root, dir }).id;
  writeFileSync(join(dir, 'write.json'), '{}');
  writeFileSync(join(dir, 'researcher.json'), '{}');
  assert.equal(loadWorkflow(pinned, { root, dir }).id, pinned);
});

test('P1: a pinned blob of a broken copy refuses to load too, and refuses before it is stored', () => {
  const wf = broken((w) => { delete w.meta.stages.verify.task; });
  const bytes = Buffer.from(JSON.stringify(wf, null, 2));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const root = fresh('p1root');
  mkdirSync(join(root, 'blobs'), { recursive: true });
  writeFileSync(join(root, 'blobs', hash), bytes);
  assert.throws(() => loadWorkflow(`quick-fix@${hash}`, { root }), /refuses to load: .*stage verify has no rules/);
  const other = fresh('p1root2');
  assert.throws(() => loadWorkflow('quick-fix', { dir: dirWith(wf), root: other }), /refuses to load/);
  assert.ok(!existsSync(join(other, 'blobs', hash)), 'a refused workflow is not stored as a blob');
});

test('P1: the three repo workflows load, plain and pinned', () => {
  const root = fresh('p1ok');
  for (const name of ['quick-fix', 'research', 'feature']) {
    const spec = loadWorkflow(name, { root });
    assert.ok(Object.keys(spec.meta.stages).length >= 1, `${name} declares its stages`);
    assert.equal(loadWorkflow(spec.id, { root }).id, spec.id);
  }
});
