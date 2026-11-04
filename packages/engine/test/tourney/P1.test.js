// P1 (stage-contract pack): a workflow whose model stage lacks a required part, or breaks the contract's field
// rules, refuses to load. Each copy is written to a temp dir and loaded through the real loadWorkflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
import { WORKFLOWS } from './contract.js';

const PARTS = ['role', 'task', 'inputs', 'limits', 'output', 'return'];

// Write a changed copy of workflow `name` and load it by name from that dir.
function loadChanged(name, change) {
  const spec = structuredClone(WORKFLOWS[name]);
  change(spec);
  const dir = mkdtempSync(join(tmpdir(), 'p1-'));
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(spec, null, 2));
  return () => loadWorkflow(name, { dir });
}

test('P1: the three repo workflows load, and each declares a stage for every agent it invokes', () => {
  for (const name of Object.keys(WORKFLOWS)) {
    const spec = loadWorkflow(name);
    assert.ok(Object.keys(spec.meta.stages).length >= 1, `${name} has stages`);
  }
  assert.deepEqual(Object.keys(loadWorkflow('quick-fix').meta.stages), ['brief', 'build', 'verify']);
  assert.deepEqual(Object.keys(loadWorkflow('research').meta.stages), ['brief', 'researcher', 'write', 'verify']);
  assert.deepEqual(Object.keys(loadWorkflow('feature').meta.stages), ['brief']);
});

test('P1: every stage of every workflow, missing any one of its six parts, refuses to load', () => {
  let n = 0;
  for (const [name, wf] of Object.entries(WORKFLOWS)) {
    for (const src of Object.keys(wf.meta.stages)) {
      for (const p of PARTS) {
        assert.throws(loadChanged(name, (s) => { delete s.meta.stages[src][p]; }), new RegExp(`stage ${src} lacks ${p}$`), `${name} ${src} without ${p}`);
        n++;
      }
    }
  }
  assert.equal(n, 6 * (3 + 4 + 1), 'all 8 stages, 6 parts each');
});

test('P1: broken field rules refuse to load: no meaning, bad trust, unexplained output, undeclared invoke input, task from a data input', () => {
  const cases = [
    ['quick-fix', (s) => { delete s.meta.stages.build.inputs.previous.meaning; }, /stage build input previous lacks meaning/],
    ['quick-fix', (s) => { s.meta.stages.verify.inputs.issue.trust = 'maybe'; }, /stage verify input issue lacks trust/],
    ['quick-fix', (s) => { delete s.meta.stages.verify.output.lines; }, /stage verify output lines lacks meaning/],
    ['quick-fix', (s) => { s.meta.stages.build.output.extra = { meaning: 'x' }; }, /stage build output extra undeclared/],
    ['quick-fix', (s) => { s.states.building.invoke.input.secret = 'context.issue'; }, /stage build invoke build inputs differ/],
    ['quick-fix', (s) => { delete s.states.verifying.invoke.input.target; }, /stage verify invoke verify inputs differ/],
    ['quick-fix', (s) => { s.meta.stages.build.task = { input: 'issue' }; }, /stage build task is invalid/],
    ['quick-fix', (s) => { s.meta.stages.brief.task = ''; }, /stage brief task is invalid/],
    ['quick-fix', (s) => { s.meta.stages.verify.limits = []; }, /stage verify limits are empty/],
    ['quick-fix', (s) => { s.meta.stages.verify.role = ' '; }, /stage verify role is empty/],
    ['quick-fix', (s) => { s.meta.stages.verify.extra = 'x'; }, /stage verify has part extra/],
    ['quick-fix', (s) => { s.meta.stages.verify.output.lines.covers = 'nothing.expect'; }, /stage verify output lines covers nothing/],
    ['research', (s) => { delete s.meta.actors.write; }, /stage write lacks output schema/],
    ['feature', (s) => { s.meta.stages.brief.inputs.earlier.note = 'x'; }, /stage brief input earlier has note/]
  ];
  for (const [name, change, want] of cases) assert.throws(loadChanged(name, change), want, String(want));
});

test('P1: a pinned workflow blob that lacks a part refuses to load too', () => {
  const spec = structuredClone(WORKFLOWS['quick-fix']);
  delete spec.meta.stages.verify.limits;
  const bytes = JSON.stringify(spec);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const root = mkdtempSync(join(tmpdir(), 'p1-root-'));
  mkdirSync(join(root, 'blobs'));
  writeFileSync(join(root, 'blobs', hash), bytes);
  assert.throws(() => loadWorkflow(`quick-fix@${hash}`, { root }), /stage verify lacks limits$/);
});
