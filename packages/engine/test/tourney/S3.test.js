// Stage-contract cleanup, items C, D and E: the load check refuses, loudly and by name,
// (C) a workflow pinned before the stage contract, whose agents are plain schemas that no handler would take;
// (D) a stage that can say PASS but declares no covers, so the host could not check its verdict line by line;
// (E) a stage input wired to a context path that nothing in the chart, the item's input or the context default gives.
// Every case goes through the real loadWorkflow, pinned or by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
import { stagesOf } from '../../src/stages.js';
import { WORKFLOWS } from './contract.js';

// A workflow copy as a pinned blob under a fresh root; returns a loader of `name@hash`.
function pin(name, change) {
  const spec = structuredClone(WORKFLOWS[name]);
  change(spec);
  const bytes = JSON.stringify(spec);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const root = mkdtempSync(join(tmpdir(), 's3-root-'));
  mkdirSync(join(root, 'blobs'));
  writeFileSync(join(root, 'blobs', hash), bytes);
  return () => loadWorkflow(`${name}@${hash}`, { root });
}
// A workflow copy loaded by name from a temp folder (beside copies of the other repo workflows, so children resolve).
function changed(name, change) {
  const dir = mkdtempSync(join(tmpdir(), 's3-'));
  for (const [n, wf] of Object.entries(WORKFLOWS)) writeFileSync(join(dir, `${n}.json`), JSON.stringify(wf));
  const spec = structuredClone(WORKFLOWS[name]);
  change(spec);
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(spec));
  return () => loadWorkflow(name, { dir });
}
// What a workflow looked like before the stage contract: its agents were bare output schemas.
const preContract = (spec) => {
  for (const src of stagesOf(spec)) {
    for (const k of ['rules', 'inputs', 'task']) delete spec.meta.actors[src][k];
    for (const p of Object.values(spec.meta.actors[src].properties)) delete p.covers;
  }
};

test('S3 (C): a pre-contract quick-fix pinned in the journal is refused at load, naming the actor and the parts it lacks', () => {
  assert.throws(pin('quick-fix', preContract), (error) => {
    assert.match(error.message, /^quick-fix@[0-9a-f]{64}: actor brief, invoked at \/states\/briefing\/invoke, is not a stage \(it lacks rules and inputs\)/);
    assert.match(error.message, /a host effect \(merge, ask, post\) or a workflow/);
    assert.match(error.message, /pinned before the stage contract cannot run/);
    return true;
  });
});

test('S3 (C): the same holds for research and feature, and for one stage stripped of its parts', () => {
  assert.throws(pin('research', preContract), /actor brief, invoked at \/states\/planning\/invoke, is not a stage \(it lacks rules and inputs\)/);
  assert.throws(pin('feature', preContract), /actor brief, invoked at \/states\/planning\/invoke, is not a stage/);
  assert.throws(changed('quick-fix', (s) => { delete s.meta.actors.verify.rules; delete s.meta.actors.verify.inputs; }),
    /actor verify, invoked at \/states\/verifying\/invoke, is not a stage \(it lacks rules and inputs\)/);
});

test('S3 (C): host effects and child workflows still load; an unknown actor name does not', () => {
  assert.doesNotThrow(changed('feature', () => {}));
  assert.throws(changed('feature', (s) => { s.states.slicing.invoke[0].src = 'quick-fixx'; s.meta.actors['quick-fixx'] = s.meta.actors['quick-fix']; }),
    /actor quick-fixx, invoked at \/states\/slicing\/invoke\/0, is not a stage/);
});

test('S3 (D): a stage that can say PASS but declares no covers is refused at load, in quick-fix and research', () => {
  for (const name of ['quick-fix', 'research']) {
    assert.throws(changed(name, (s) => { delete s.meta.actors.verify.properties.lines.covers; }),
      /stage verify output result can say PASS, but no output field declares covers$/, name);
    assert.throws(pin(name, (s) => { delete s.meta.actors.verify.properties.lines.covers; }), /no output field declares covers$/, `${name} pinned`);
  }
  // A stage with no PASS/FAIL result needs no covers: build loads without one.
  assert.ok(!Object.values(WORKFLOWS['quick-fix'].meta.actors.build.properties).some((p) => 'covers' in p));
});

test('S3 (E): a stage input read from a context path nothing writes is refused at load', () => {
  const cases = [
    // A typo in the wiring: briefs.builer is never written.
    ['quick-fix', (s) => { s.states.building.invoke.input.task = 'context.briefs.builer'; }, /stage build input task reads context\.briefs\.builer, which nothing writes/],
    // The writer of a path removed: nothing sets briefs any more.
    ['quick-fix', (s) => { s.states.briefing.invoke.onDone.actions[0].params = { other: 'event.output' }; s.context.other = null; }, /stage build input task reads context\.briefs\.builder, which nothing writes/],
    // A path only ever reset to null is still dangling.
    ['research', (s) => { s.states.writing.invoke.input.answers = 'context.notes'; s.context.notes = null; }, /stage write input answers reads context\.notes, which nothing writes/],
    // An input read from somewhere that is not the context.
    ['research', (s) => { s.states.verifying.invoke.input.draft = 'event.output'; }, /stage verify input draft reads "event\.output": an input is a context path or a literal/],
    ['feature', (s) => { s.states.planning.invoke.input.earlier = 'context.slicez'; }, /stage brief input earlier reads context\.slicez, which nothing writes/]
  ];
  for (const [name, change, want] of cases) assert.throws(changed(name, change), want, String(want));
});

test('S3 (E): the repo workflows are fully wired: item input, a set action or a literal feeds every stage input', () => {
  for (const name of Object.keys(WORKFLOWS)) assert.doesNotThrow(() => loadWorkflow(name), name);
  // pr.checkout is fed through pr, which build's onDone writes; the host stamps checkout on that ref.
  assert.equal(WORKFLOWS['quick-fix'].states.verifying.invoke.input.checkout, 'context.pr.checkout');
});
