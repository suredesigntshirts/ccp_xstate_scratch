// Stage-contract cleanup, items C, D and E: the load check refuses, loudly and by name,
// (C) a workflow pinned before the stage contract, whose agents are plain schemas that no handler would take;
// (D) a stage that can say PASS but declares no covers, so the host could not check its verdict line by line: its
//     schema lists PASS in any field and any case ($refs resolved), or the chart branches on PASS from its output;
//     and a covers that names no list of lines, or sits on a field that is no list of { line, result };
// (E) an invoke input (stage, effect or child workflow) wired to a context path that nothing feeds when the invoke's
//     state is entered: no item input field, no context default at that path, no write on a way into that state, or
//     a write whose source (an output schema, an event schema, a literal, a copy, an error) has no such part.
// Every case goes through the real loadWorkflow, pinned or by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
import { stagesOf, uncovered } from '../../src/stages.js';
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

test('S3 (C): a round-2 blob, whose stages carry a task part instead of an input task, is refused naming that form', () => {
  const round2 = (s) => {
    for (const src of stagesOf(s)) { s.meta.actors[src].task = 'x'; delete s.meta.actors[src].inputs.task; }
    for (const inv of [s.states.briefing, s.states.building, s.states.verifying, s.states.reverifying].map((st) => st.invoke)) delete inv.input.task;
  };
  assert.throws(pin('quick-fix', round2), /quick-fix@[0-9a-f]{64}: stage brief has a task part, the form before this contract: declare an input task and wire it in the invoke$/);
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

test('S3 (D): no spelling of the verdict switches coverage off: $ref, open string, another field name, lower case', () => {
  const noCovers = (s) => { delete s.meta.actors.verify.properties.lines.covers; };
  const cases = [
    // The result as a $ref to an enum schema.
    [(s) => { s.meta.schemas.verdict = { enum: ['PASS', 'FAIL'] }; s.meta.actors.verify.properties.result = { $ref: '#verdict', description: 'x' }; }, /stage verify output result can say PASS, but no output field declares covers$/],
    // An open string: the schema does not list PASS, but the chart branches on it (verifiedHead).
    [(s) => { s.meta.actors.verify.properties.result = { type: 'string', description: 'PASS or FAIL' }; }, /stage verify output reaches guard (verifiedHead|failed), which tests context\.verdict\.result for PASS, but no output field declares covers$/],
    // The field renamed.
    [(s) => { const p = s.meta.actors.verify.properties; p.outcome = p.result; delete p.result; s.meta.actors.verify.required = ['outcome', 'pr', 'issue', 'lines']; }, /stage verify output outcome can say PASS/],
    // Lower case.
    [(s) => { s.meta.actors.verify.properties.result.enum = ['pass', 'fail']; }, /stage verify output result can say PASS/],
    // A guard on event.output in the stage's own onDone, with an open string result.
    [(s) => {
      s.meta.actors.verify.properties.result = { type: 'string', description: 'x' };
      s.meta.guards.verifiedHead = s.meta.guards.verifiedHead.filter((c) => c.path !== 'context.verdict.result');
      s.meta.guards.failed = [{ path: 'context.verdict.pr.url', in: ['never'] }];
      s.meta.guards.passNow = [{ path: 'event.output.result', in: ['PASS'] }];
      s.states.verifying.invoke.onDone[2].guard = 'passNow';
    }, /stage verify output reaches guard passNow, which tests event\.output\.result for PASS/]
  ];
  for (const [change, want] of cases) assert.throws(changed('quick-fix', (s) => { change(s); noCovers(s); }), want, String(want));
  // A covers that names no list of lines, or on a field that is no list of { line, result }, is refused at load too.
  assert.throws(changed('quick-fix', (s) => { s.meta.actors.verify.properties.lines.covers = 'issue.url'; }), /stage verify output lines covers issue\.url, which is not a list in the input invoke verify gives \(at \/states\/verifying\/invoke\)/);
  assert.throws(changed('quick-fix', (s) => { s.meta.actors.verify.properties.lines.covers = 'issue.expectt'; }), /covers issue\.expectt, which is not a list/);
  assert.throws(changed('research', (s) => { s.meta.actors.verify.properties.lines.covers = 'draft.text'; }), /stage verify output lines covers draft\.text, which is not a list/);
  assert.throws(changed('quick-fix', (s) => { noCovers(s); s.meta.actors.verify.properties.note = { type: 'string', covers: 'issue.expect' }; }), /stage verify output note covers issue\.expect, but is not a list of \{ line, result \} entries/);
  // At accept, an overall word in any field and any case must agree with the lines.
  const schema = { properties: { lines: { covers: 'issue.expect' } } };
  const input = { issue: { expect: ['a'] } };
  assert.equal(uncovered(schema, input, { outcome: 'pass', lines: [{ line: 'a', result: 'FAIL' }] }), 'result.outcome disagrees with result.lines');
  assert.equal(uncovered(schema, input, { outcome: 'FAIL', lines: [{ line: 'a', result: 'FAIL' }] }), null);
  assert.equal(uncovered({ properties: { lines: { covers: 'issue.url' } } }, { issue: { url: 'u' } }, { lines: [] }), 'issue.url is not a list');
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
    ['feature', (s) => { s.states.planning.invoke.input.earlier = 'context.slicez'; }, /stage brief input earlier reads context\.slicez, which nothing writes/],
    // A typo below a field of the item's input: meta.input says what issue holds.
    ['quick-fix', (s) => { s.states.building.invoke.input.issue = 'context.issue.expectt'; }, /stage build input issue reads context\.issue\.expectt, which nothing writes before building/],
    // A copy of a path nothing writes feeds nothing.
    ['quick-fix', (s) => { s.context.x = null; s.states.briefing.invoke.onDone.actions.push({ type: 'set', params: { x: 'context.nothing' } }); s.states.building.invoke.input.previous = 'context.x'; }, /stage build input previous reads context\.x, which nothing writes/],
    // A non-null context default feeds only the path it holds, not every path below it.
    ['quick-fix', (s) => { s.context.briefs = {}; s.states.building.invoke.input.task = 'context.briefs.builer'; }, /stage build input task reads context\.briefs\.builer, which nothing writes/],
    // An error has no parts.
    ['quick-fix', (s) => { s.states.building.invoke.input.failure = 'context.failure.zzz'; }, /stage build input failure reads context\.failure\.zzz, which nothing writes/],
    // Order: merge is written only on the way into done, a final state, so no build can ever read it.
    ['quick-fix', (s) => { s.states.building.invoke.input.previous = 'context.merge'; }, /stage build input previous reads context\.merge, which nothing writes before building: no item input, context default or set action on a way into building gives it/],
    // Effect and child-workflow inputs are wired the same way.
    ['quick-fix', (s) => { s.states.merging.invoke.input.sha = 'context.nope'; }, /effect merge input sha reads context\.nope, which nothing writes before merging/],
    ['feature', (s) => { s.states.slicing.invoke[0].input.issue = 'context.plan.slicez.0'; }, /workflow quick-fix input issue reads context\.plan\.slicez\.0, which nothing writes before slicing/]
  ];
  for (const [name, change, want] of cases) assert.throws(changed(name, change), want, String(want));
});

test('S3 (E): the repo workflows are fully wired: item input, a set action or a literal feeds every invoke input', () => {
  for (const name of Object.keys(WORKFLOWS)) assert.doesNotThrow(() => loadWorkflow(name), name);
  // pr.checkout is fed through pr, which build's onDone writes; the host stamps checkout on that ref.
  assert.equal(WORKFLOWS['quick-fix'].states.verifying.invoke.input.checkout, 'context.pr.checkout');
});
