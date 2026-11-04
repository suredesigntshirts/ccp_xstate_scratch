// P1 (stage-contract pack, lane S round 2): a workflow whose model stage lacks a required part, or breaks the
// contract's field rules, refuses to load. A model stage is a meta.actors entry with the parts rules, task and inputs.
// Each copy is written to a temp dir and loaded through the real loadWorkflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
import { stagesOf } from '../../src/stages.js';
import { WORKFLOWS } from './contract.js';

const PARTS = ['rules', 'task', 'inputs'];

// Write a changed copy of workflow `name` and load it by name from that dir.
function loadChanged(name, change) {
  const spec = structuredClone(WORKFLOWS[name]);
  change(spec);
  const dir = mkdtempSync(join(tmpdir(), 'p1-'));
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(spec, null, 2));
  return () => loadWorkflow(name, { dir });
}

test('P1: the three repo workflows load, and their model stages are the agents they invoke', () => {
  assert.deepEqual(stagesOf(loadWorkflow('quick-fix')), ['brief', 'build', 'verify']);
  assert.deepEqual(stagesOf(loadWorkflow('research')), ['brief', 'researcher', 'write', 'verify']);
  assert.deepEqual(stagesOf(loadWorkflow('feature')), ['brief']);
  for (const name of Object.keys(WORKFLOWS)) assert.ok(!('stages' in WORKFLOWS[name].meta), `${name}: no separate meta.stages key`);
});

test('P1: every stage of every workflow, missing any one of its parts, refuses to load', () => {
  let n = 0;
  for (const [name, wf] of Object.entries(WORKFLOWS)) {
    for (const src of stagesOf(wf)) {
      for (const p of PARTS) {
        assert.throws(loadChanged(name, (s) => { delete s.meta.actors[src][p]; }), new RegExp(`stage ${src} lacks ${p}$`), `${name} ${src} without ${p}`);
        n++;
      }
    }
  }
  assert.equal(n, 3 * (3 + 4 + 1), 'all 8 stages, 3 parts each');
});

test('P1: broken field rules refuse to load: no meaning, empty rules or task, no output schema, a covers path to nothing, invoke inputs that differ', () => {
  const cases = [
    ['quick-fix', (s) => { s.meta.actors.build.inputs.previous = ''; }, /stage build input previous lacks meaning/],
    ['quick-fix', (s) => { s.meta.actors.verify.inputs.issue = { meaning: 'x' }; }, /stage verify input issue lacks meaning/],
    ['quick-fix', (s) => { s.meta.actors.verify.rules = []; }, /stage verify rules are empty/],
    ['quick-fix', (s) => { s.meta.actors.verify.rules = ['ok', ' ']; }, /stage verify rules are empty/],
    ['quick-fix', (s) => { s.meta.actors.brief.task = ''; }, /stage brief task is empty/],
    ['quick-fix', (s) => { s.meta.actors.build.inputs = ['brief']; }, /stage build inputs are invalid/],
    ['quick-fix', (s) => { delete s.meta.actors.build.properties; }, /stage build lacks output schema/],
    ['quick-fix', (s) => { s.meta.actors.verify.properties.lines.covers = 'nothing.expect'; }, /stage verify output lines covers nothing/],
    ['quick-fix', (s) => { s.states.building.invoke.input.secret = 'context.issue'; }, /stage build invoke build inputs differ/],
    ['quick-fix', (s) => { delete s.states.verifying.invoke.input.target; }, /stage verify invoke verify inputs differ/],
    ['research', (s) => { s.meta.actors.write.inputs.extra = 'declared but never given'; }, /stage write invoke write inputs differ/],
    ['feature', (s) => { delete s.meta.actors.brief.inputs.earlier; }, /stage brief invoke brief inputs differ/]
  ];
  for (const [name, change, want] of cases) assert.throws(loadChanged(name, change), want, String(want));
});

test('P1: a pinned workflow blob that lacks a part refuses to load too', () => {
  const spec = structuredClone(WORKFLOWS['quick-fix']);
  delete spec.meta.actors.verify.rules;
  const bytes = JSON.stringify(spec);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const root = mkdtempSync(join(tmpdir(), 'p1-root-'));
  mkdirSync(join(root, 'blobs'));
  writeFileSync(join(root, 'blobs', hash), bytes);
  assert.throws(() => loadWorkflow(`quick-fix@${hash}`, { root }), /stage verify lacks rules$/);
});
