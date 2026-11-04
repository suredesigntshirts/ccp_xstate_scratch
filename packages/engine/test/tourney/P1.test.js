// P1 Missing part refuses to load (stage contract, lane M): a workflow whose model stage lacks a required part throws
// at load, on the plain path and on the pinned path; the three repo workflows load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
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
  ['an invoke with no task', (wf) => { delete wf.states.building.invoke.input.task; }, /building: invoke build \(stage build\) has no task input/],
  ['a meaning for an input the invoke does not give', (wf) => { wf.meta.stages.build.extra = 'not given'; }, /meta\.stages\.build\.extra explains an input this invoke does not give/],
  ['a stage with its whole entry deleted', (wf) => { delete wf.meta.stages.build; }, /building: build is not a stage, a host effect or a workflow/],
  ['a stage with no output', (wf) => { delete wf.meta.actors.verify; }, /stage verify has no output: meta\.actors\.verify is missing/],
  ['a verifier that need not cover the expect lines', (wf) => { wf.meta.actors.verify.required = wf.meta.actors.verify.required.filter((k) => k !== 'lines'); }, /stage verify grades issue, so its output must require lines/]
];

for (const [name, change, message] of CASES) {
  test(`P1: ${name} refuses to load`, () => {
    const dir = dirWith(broken(change));
    assert.throws(() => loadWorkflow('quick-fix', { dir }), (e) => /^workflow quick-fix refuses to load: /.test(e.message) && message.test(e.message));
  });
}

test('P1: a stage named like a workflow refuses to load (its invoke would start that workflow instead)', () => {
  const dir = dirWith(workflow('quick-fix'), { build: '{}' });
  assert.throws(() => loadWorkflow('quick-fix', { dir }), /stage build has the name of a workflow/);
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
