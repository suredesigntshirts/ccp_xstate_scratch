// P2 No prompt wording in engine code (stage contract, lane M): every rendered prompt is cut, piece by piece, into
// the workflow JSON's words (rule lines, input meanings, the output schema), the run's data (task value, input values)
// and a short allowlist of the renderer's fixed frame; nothing may be left over. The engine source holds none of the
// workflows' rule lines, and none of lane A's moved role or ref phrases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promptsOf, workflow, FRAME, FIX, resolve, lines } from './contract.js';

const SRC = new URL('../../src/', import.meta.url).pathname;
const sources = (d = SRC) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? sources(p) : f.endsWith('.js') ? [p] : []; });

test('P2: every rendered prompt is the workflow\'s words, the run\'s data and the fixed frame, and nothing else', async () => {
  const p = await promptsOf();
  assert.deepEqual(Object.keys(p).sort(), ['ft.brief', 'qf.brief', 'qf.build', 'qf.verify', 'rs.brief', 'rs.researcher', 'rs.verify', 'rs.write']);
  for (const [key, { text, run, stage, schema, defs, wf }] of Object.entries(p)) {
    let rest = text;
    const cut = (piece, what) => {
      const at = rest.indexOf(piece);
      assert.ok(at >= 0, `${key}: ${what} not found in the prompt: ${JSON.stringify(piece).slice(0, 120)}`);
      rest = rest.slice(0, at) + '\n' + rest.slice(at + piece.length);
    };
    const cutRe = (re, what) => { assert.ok(re.test(rest), `${key}: ${what} not found`); rest = rest.replace(re, '\n'); };
    // From the workflow JSON: the output schema (resolved), every rule line, every input's meaning.
    cut(JSON.stringify(resolve(schema, defs), null, 2), 'the output schema');
    for (const l of lines(stage.task)) cut(`\n- ${l}\n`, 'a rule line');
    for (const [k, m] of Object.entries(stage)) if (k !== 'task') cut(`\n- ${k}: ${lines(m).join(' ')}\n  ${JSON.stringify(run.input[k] ?? null)}\n`, `input ${k} with its meaning and value`);
    // The task: a literal from the workflow's own invoke, or a brief agent's fixture, never anything else.
    const literals = JSON.stringify(wf.states).match(/"task":\{"value":"((?:[^"\\]|\\.)*)"\}/g)?.map((m) => JSON.parse(m.slice(7)).value) ?? [];
    assert.ok(literals.includes(run.input.task) || Object.values(FIX).includes(run.input.task), `${key}: the task is from the workflow or a brief`);
    cut(`\n# Task\n${run.input.task}\n`, 'the task');
    // The fixed frame.
    cutRe(FRAME.run, 'the Run line');
    cutRe(FRAME.ret, 'the Return paragraph');
    for (const s of [FRAME.rules, `- ${FRAME.data}`, FRAME.output, ...FRAME.headings.filter((h) => h !== '# Task' && h !== '# Inputs')]) cut(s, `frame: ${s.slice(0, 30)}`);
    if (Object.keys(stage).length > 1) { cut('# Inputs', 'frame: # Inputs'); cut(FRAME.inputs, 'frame: inputs sentence'); }
    assert.equal(rest.trim(), '', `${key}: wording left that is neither workflow JSON nor frame: ${JSON.stringify(rest.trim()).slice(0, 200)}`);
  }
});

test('P2: the engine source holds no workflow rule line and none of lane A\'s moved role and ref phrases', () => {
  const src = sources().map((f) => [f, readFileSync(f, 'utf8')]);
  const ruleLines = ['quick-fix', 'research', 'feature'].flatMap((n) => Object.values(workflow(n).meta.stages).flatMap((s) => lines(s.task)));
  for (const [f, text] of src) {
    for (const l of ruleLines) assert.ok(!text.includes(l.slice(0, 40)), `${f} holds workflow wording: ${l.slice(0, 40)}`);
    for (const phrase of ['You are the', 'Commit and push', 'open no PR', 'Every reference you return', 'Your task:', 'Never set key, gates or green']) {
      assert.ok(!text.includes(phrase), `${f} still holds "${phrase}"`);
    }
  }
});
