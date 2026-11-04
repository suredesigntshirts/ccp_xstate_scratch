// Stage-contract cleanup, items C, D and E: the load check refuses, loudly and by name,
// (C) a workflow pinned before the stage contract, whose agents are plain schemas that no handler would take;
// (D) a stage given lines (an input that may hold a list of text) whose output the chart decides on (a guard tests a
//     value the stage chose, through its onDone or a context path written from it, copies followed) but that declares
//     no covers, however the verdict is spelled, typed, nested, copied or routed; a chart that decides on any field of
//     a covering stage other than the covered list or a PASS/FAIL word field; and a covers that names no list of
//     lines, or sits on a field that is no list of { line, result };
// (E) an invoke input (stage, effect or child workflow) wired to a context path that nothing feeds when the invoke's
//     state is entered: no item input field, no context default at that path, no write on a way into that state, or
//     a write whose source (an output schema, an event schema, a literal, a copy, an error) has no such part, or a
//     write on a transition out of a state the item can never be in; and a child workflow invoke that lacks an input
//     the child's item input requires.
// Every case goes through the real loadWorkflow, pinned or by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
import { decisions, stagesOf, uncovered } from '../../src/stages.js';
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

test('S3 (D): a stage given lines whose output the chart decides on, with no covers, is refused at load, in quick-fix and research', () => {
  for (const name of ['quick-fix', 'research']) {
    assert.throws(changed(name, (s) => { delete s.meta.actors.verify.properties.lines.covers; }),
      /stage verify output result decides guard \w+ \(at \/meta\/guards\/\w+\/0\) while input issue may hold lines, but no output field declares covers$/, name);
    assert.throws(pin(name, (s) => { delete s.meta.actors.verify.properties.lines.covers; }), /but no output field declares covers$/, `${name} pinned`);
  }
  // Stages the chart does not decide on need no covers, though they are given the expect lines: build, brief, write.
  assert.ok(!Object.values(WORKFLOWS['quick-fix'].meta.actors.build.properties).some((p) => 'covers' in p));
  for (const name of Object.keys(WORKFLOWS)) {
    const spec = loadWorkflow(name);
    for (const src of stagesOf(spec)) assert.deepEqual(decisions(spec, src).map((d) => d.segs.join('.')), src === 'verify' ? ['result', 'result'] : [], `${name} ${src}`);
  }
});

test('S3 (D): no spelling, shape, copy or routing of the verdict switches coverage off', () => {
  const noCovers = (s) => { delete s.meta.actors.verify.properties.lines?.covers; };
  const uncoveredVerdict = /stage verify output [\w.]+ decides guard \w+ \(at \/meta\/guards\/\w+\/\d+\) while input issue may hold lines, but no output field declares covers$/;
  const v = (s) => s.meta.actors.verify.properties;
  const req = (s, f) => { s.meta.actors.verify.required = s.meta.actors.verify.required.filter((r) => r !== f); };
  const dropLines = (s) => { delete v(s).lines; req(s, 'lines'); };
  const cases = [
    // The result as a $ref to an enum schema.
    (s) => { s.meta.schemas.verdict = { enum: ['PASS', 'FAIL'] }; v(s).result = { $ref: '#verdict', description: 'x' }; },
    // An open string the chart branches on (verifiedHead, failed).
    (s) => { v(s).result = { type: 'string', description: 'PASS or FAIL' }; },
    // The field renamed.
    (s) => { v(s).outcome = v(s).result; delete v(s).result; s.meta.actors.verify.required = ['outcome', 'pr', 'issue', 'lines']; for (const g of ['verifiedHead', 'failed']) s.meta.guards[g][0].path = 'context.verdict.outcome'; },
    // Lower case.
    (s) => { v(s).result.enum = ['pass', 'fail']; s.meta.guards.verifiedHead[0].in = ['pass']; s.meta.guards.failed[0].in = ['fail']; },
    // A guard on event.output in the stage's own onDone, with an open string result.
    (s) => {
      v(s).result = { type: 'string', description: 'x' };
      s.meta.guards.verifiedHead = s.meta.guards.verifiedHead.filter((c) => c.path !== 'context.verdict.result');
      s.meta.guards.failed = [{ path: 'context.verdict.pr.url', in: ['never'] }];
      s.meta.guards.passNow = [{ path: 'event.output.result', in: ['PASS'] }];
      s.states.verifying.invoke.onDone[2].guard = 'passNow';
    },
    // Round 3, the verifier's cases: a boolean verdict.
    (s) => { v(s).result = { type: 'boolean', description: 'x' }; s.meta.guards.verifiedHead[0] = { path: 'context.verdict.result', in: [true] }; s.meta.guards.failed = [{ path: 'context.verdict.result', in: [false] }]; },
    // Another word.
    (s) => { v(s).result = { enum: ['Passed', 'Failed'], description: 'x' }; s.meta.guards.verifiedHead[0] = { path: 'context.verdict.result', in: ['Passed'] }; s.meta.guards.failed = [{ path: 'context.verdict.result', in: ['Failed'] }]; },
    // The verdict copied to another context path, and the guards read the copy.
    (s) => {
      v(s).result = { type: 'string', description: 'x' };
      for (const st of [s.states.verifying, s.states.reverifying]) for (const t of st.invoke.onDone) t.actions = [{ type: 'set', params: { verdict: 'event.output', ok: 'context.verdict.result' } }];
      s.context.ok = null;
      s.meta.guards.verifiedHead[0] = { path: 'context.ok', in: ['PASS'] };
      s.meta.guards.failed = [{ path: 'context.ok', in: ['FAIL'] }];
    },
    // The whole verdict copied, and the guards read below the copy.
    (s) => {
      for (const st of [s.states.verifying, s.states.reverifying]) for (const t of st.invoke.onDone) t.actions = [{ type: 'set', params: { verdict: 'event.output', v2: 'context.verdict' } }];
      s.context.v2 = null;
      s.meta.guards.failed = [{ path: 'context.v2.result', in: ['FAIL'] }];
    },
    // Guards that compare with a context literal by same.
    (s) => {
      v(s).result = { type: 'string', description: 'x' };
      s.context.word = 'PASS'; s.context.fword = 'FAIL';
      s.meta.guards.verifiedHead[0] = { path: 'context.verdict.result', same: 'context.word' };
      s.meta.guards.failed = [{ path: 'context.verdict.result', same: 'context.fword' }];
    },
    // No overall result at all: the chart routes on the first line's result.
    (s) => { delete v(s).result; req(s, 'result'); s.meta.guards.verifiedHead.shift(); s.meta.guards.failed = [{ path: 'context.verdict.lines.0.result', in: ['FAIL'] }]; },
    // The entries' result renamed ({ line, ok }).
    (s) => { s.meta.schemas.line = { type: 'object', required: ['line', 'ok'], properties: { line: { type: 'string' }, ok: { type: 'boolean' } } }; },
    // Round 4, the verifier's cases. Results line by line under another key, no overall result.
    (s) => {
      s.meta.schemas.line = { type: 'object', required: ['check', 'result', 'evidence'], properties: { check: { type: 'string' }, result: { enum: ['PASS', 'FAIL'] }, evidence: { type: 'string' } } };
      delete v(s).result; req(s, 'result'); s.meta.guards.verifiedHead.shift(); s.meta.guards.failed = [{ path: 'context.verdict.lines.0.result', in: ['FAIL'] }];
    },
    // No per-line list, and a boolean verdict.
    (s) => { dropLines(s); v(s).result = { type: 'boolean', description: 'x' }; s.meta.guards.verifiedHead[0] = { path: 'context.verdict.result', in: [true] }; s.meta.guards.failed = [{ path: 'context.verdict.result', in: [false] }]; },
    // No per-line list, and an open string described as PASS or FAIL.
    (s) => { dropLines(s); v(s).result = { type: 'string', description: 'PASS or FAIL' }; },
    // No per-line list, and the word nested in an object.
    (s) => {
      dropLines(s); v(s).result = { type: 'object', properties: { word: { enum: ['PASS', 'FAIL'] } }, description: 'x' };
      s.meta.guards.verifiedHead[0] = { path: 'context.verdict.result.word', in: ['PASS'] }; s.meta.guards.failed = [{ path: 'context.verdict.result.word', in: ['FAIL'] }];
    },
    // A verdict by presence: an optional list of failures.
    (s) => { delete v(s).result; req(s, 'result'); s.meta.guards.verifiedHead.shift(); v(s).failures = { type: 'array', items: { type: 'string' }, description: 'x' }; s.meta.guards.failed = ['context.verdict.failures']; },
    // A verdict by same against an observed value: a sha the stage returns only on a pass.
    (s) => { delete v(s).result; req(s, 'result'); v(s).passedAt = { type: 'string', description: 'x' }; s.meta.guards.verifiedHead[0] = { path: 'context.verdict.passedAt', same: 'context.pr.at' }; s.meta.guards.failed = [{ path: 'context.verdict.pr.url', in: ['never'] }]; },
    // A verdict by presence of an optional ref: the host checks a ref's value, but the stage chooses whether to give it.
    (s) => { delete v(s).result; req(s, 'result'); v(s).ok = { $ref: '#ref', description: 'x' }; s.meta.guards.verifiedHead[0] = 'context.verdict.ok'; s.meta.guards.failed = [{ path: 'context.verdict.pr.url', in: ['never'] }]; }
  ];
  for (const change of cases) assert.throws(changed('quick-fix', (s) => { change(s); noCovers(s); }), uncoveredVerdict, String(change));
  // The same in research, where verify also restates issue and returns sources.
  assert.throws(changed('research', (s) => { noCovers(s); dropLines(s); v(s).result = { type: 'boolean', description: 'x' }; s.meta.guards.passed[0] = { path: 'context.verdict.result', in: [true] }; s.meta.guards.failed = [{ path: 'context.verdict.result', in: [false] }]; }), uncoveredVerdict);
  // With covers kept, the chart may decide only on what accept holds to the covered lines: the covered field, or a
  // field whose every value is the word PASS or FAIL. Anything else beside a covered list is refused.
  const offLines = /stage verify output [\w.]+ decides guard \w+ \(at \/meta\/guards\/\w+\/\d+\), but the host holds only lines and PASS\/FAIL word fields to the covered lines: decide on those$/;
  const beside = [
    // A boolean ok the chart routes on, beside covered lines: accept could not hold it to them.
    (s) => { v(s).ok = { type: 'boolean', description: 'x' }; s.meta.actors.verify.required.push('ok'); s.meta.guards.verifiedHead[0] = { path: 'context.verdict.ok', in: [true] }; s.meta.guards.failed = [{ path: 'context.verdict.ok', in: [false] }]; },
    // A second per-line list the chart routes on.
    (s) => { v(s).again = { type: 'array', items: { $ref: '#line' }, description: 'x' }; s.meta.guards.failed = [{ path: 'context.verdict.again.0.result', in: ['FAIL'] }]; },
    // A third word accept does not know.
    (s) => { v(s).result.enum = ['PASS', 'FAIL', 'SKIP']; },
    // A required field that may be null, routed on by presence.
    (s) => { v(s).why = { type: ['string', 'null'], description: 'x' }; s.meta.actors.verify.required.push('why'); s.meta.guards.failed = ['context.verdict.why']; }
  ];
  for (const change of beside) assert.throws(changed('quick-fix', change), offLines, String(change));
  // A copy of the PASS/FAIL word may be routed on; an unrouted second list decides nothing and loads.
  assert.doesNotThrow(changed('quick-fix', (s) => {
    for (const st of [s.states.verifying, s.states.reverifying]) for (const t of st.invoke.onDone) t.actions = [{ type: 'set', params: { verdict: 'event.output', ok: 'context.verdict.result' } }];
    s.context.ok = null; s.meta.guards.verifiedHead[0] = { path: 'context.ok', in: ['PASS'] }; s.meta.guards.failed = [{ path: 'context.ok', in: ['FAIL'] }];
  }));
  assert.doesNotThrow(changed('quick-fix', (s) => { v(s).again = { type: 'array', items: { $ref: '#line' }, description: 'x' }; }));
  // Round 4 found this in research: passed also needed verdict.sources, a list the schema lets be empty, so a PASS
  // with no sources would have replanned. The guard is now the word alone; putting the old condition back is refused.
  assert.throws(changed('research', (s) => { s.meta.guards.passed.push('context.verdict.sources'); }), /stage verify output sources decides guard passed \(at \/meta\/guards\/passed\/1\), but the host holds only lines/);
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
    ['feature', (s) => { s.states.slicing.invoke[0].input.issue = 'context.plan.slicez.0'; }, /workflow quick-fix input issue reads context\.plan\.slicez\.0, which nothing writes before slicing/],
    // Round 4: a write on a transition out of a state nothing enters never runs, so it feeds nothing.
    ['quick-fix', (s) => { s.states.orphan = { on: { X: { target: 'building', actions: [{ type: 'set', params: { ghost: 'event.foo' } }] } } }; s.context.ghost = null; s.states.building.invoke.input.previous = 'context.ghost'; }, /stage build input previous reads context\.ghost, which nothing writes before building/],
    // Round 4: a child workflow's invoke gives every input the child's item input requires.
    ['feature', (s) => { delete s.states.slicing.invoke[0].input.issue; }, /workflow quick-fix invoke s1 \(at \/states\/slicing\/invoke\/0\) lacks input issue, which quick-fix's item input requires$/]
  ];
  for (const [name, change, want] of cases) assert.throws(changed(name, change), want, String(want));
});

test('S3 (E): a task wired from a context path that holds no text there is refused at load', () => {
  assert.throws(changed('quick-fix', (s) => { s.states.building.invoke.input.task = 'context.briefs'; }), /stage build task reads context\.briefs, which holds no text before building$/);
  assert.throws(changed('quick-fix', (s) => { s.states.building.invoke.input.task = 'context.issue.expect'; }), /stage build task reads context\.issue\.expect, which holds no text before building$/);
  assert.doesNotThrow(changed('quick-fix', () => {}));
});

test('S3 (E): the repo workflows are fully wired: item input, a set action or a literal feeds every invoke input', () => {
  for (const name of Object.keys(WORKFLOWS)) assert.doesNotThrow(() => loadWorkflow(name), name);
  // pr.checkout is fed through pr, which build's onDone writes; the host stamps checkout on that ref.
  assert.equal(WORKFLOWS['quick-fix'].states.verifying.invoke.input.checkout, 'context.pr.checkout');
});
