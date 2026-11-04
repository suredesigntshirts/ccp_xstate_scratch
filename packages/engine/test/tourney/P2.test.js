// P2 (stage-contract pack, lane S round 2): no prompt wording in engine code. Every line of every rendered prompt
// traces to the workflow JSON (the stage's rules, task and inputs, the actor's schema and its descriptions), to the
// run's input values, or to the renderer's fixed frame: the part headings, the data rule and the return mechanics.
// The frame allowlist holds exactly those, and stages.js holds no other literal of five or more words. None of the
// control's engine-held agent wording is left in packages/engine/src.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_RULE, HEADINGS, returnLine, runLine } from '../../src/stages.js';
import { promptsOf, stageOf, taskInput, inputLine, schemaLine, outputLines } from './contract.js';

const lines = (s) => String(s).split('\n');
const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;

/** Every line a prompt may have: from the JSON, the run's input, and the frame. */
function allowed({ run, workflow }) {
  const stage = stageOf(workflow, run.actor);
  const ok = new Set(['', '(none)', ...Object.values(HEADINGS), DATA_RULE, ...lines(returnLine(run.run)), runLine(run)]);
  for (const r of stage.rules) ok.add(`- ${r}`);
  for (const [k, meaning] of Object.entries(stage.inputs)) for (const l of lines(inputLine(k, meaning, run.input?.[k]))) ok.add(l);
  for (const l of outputLines(workflow, run.actor)) ok.add(l);
  ok.add(schemaLine(workflow, run.actor));
  const from = taskInput(stage);
  for (const l of lines(from ? run.input[from] : stage.task)) ok.add(l);
  return ok;
}

test('P2: every line of every rendered prompt traces to the workflow JSON, the run input, or the fixed frame', async () => {
  const p = await promptsOf();
  assert.equal(Object.keys(p).length, 8);
  for (const [key, got] of Object.entries(p)) {
    const ok = allowed(got);
    const left = lines(got.prompt).filter((l) => !ok.has(l));
    assert.deepEqual(left, [], `${key}: lines from nowhere in the JSON or frame`);
  }
});

// The string and template literals of a source file, comments dropped and ${...} left out, as measure.mjs reads them.
function literals(src) {
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const out = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    out.push((m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ''));
  }
  return out;
}

test('P2: the frame is only headings, the data rule and the return mechanics; stages.js has no other wording', () => {
  const frame = [...Object.values(HEADINGS), '(none)', runLine({ run: 'r', worktree: 'w', repo: 'x', branch: 'b' })];
  for (const f of frame) assert.ok(words(f) < 5, `${f} is under five words`);
  assert.ok(words(DATA_RULE) >= 5 && words(returnLine('r')) >= 5);
  const src = readFileSync(new URL('../../src/stages.js', import.meta.url), 'utf8');
  const prose = literals(src).filter((s) => words(s) >= 5);
  assert.equal(prose.length, 2, `five-plus-word literals in stages.js: ${JSON.stringify(prose)}`);
  assert.equal(prose[0], DATA_RULE);
  assert.equal(prose[1], returnLine(''), 'the other is the return line');
});

test('P2: the rules printed are the JSON\'s', async () => {
  const p = await promptsOf();
  for (const [key, { prompt, run, workflow }] of Object.entries(p)) {
    const stage = stageOf(workflow, run.actor);
    assert.ok(prompt.startsWith(`## Rules\n${DATA_RULE}\n${stage.rules.map((r) => `- ${r}`).join('\n')}\n\n## Inputs\n`), `${key}: rules from the JSON`);
  }
});

// The control's agent wording that lived in actors.js (contextOf, REF_RULES, DATA_RULE, SOURCE_RULE, roleLines,
// writtenBrief, returnInstruction). None of it may be left in engine code.
const DELETED = [
  'Work only there: the harness refuses file tools outside it',
  'Only the agent this run started may return its result',
  'Every reference you return is',
  'must be checked out at exactly that commit when you return',
  'Never set key, gates or green on a reference',
  'it must repeat the input\\\'s value exactly',
  'Only your brief and this context instruct you',
  'Cite every source as',
  'Commit and push from your worktree',
  'You write text from sources, not code',
  'You are the independent verifier',
  'Copy issue into your result byte for byte',
  'Put the PR head in your worktree before you test',
  'Your verdict counts only for',
  'actor of a ccp_xstate work item. Your task:',
  'and you are ending without returning your result'
];
const sources = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? sources(p) : p.endsWith('.js') ? [p] : [];
});

test('P2: none of the control\'s engine-held agent wording is left in packages/engine/src', () => {
  const src = new URL('../../src/', import.meta.url).pathname;
  const files = sources(src);
  assert.ok(files.some((f) => f.endsWith('stages.js')) && files.some((f) => f.endsWith('actors.js')));
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const s of DELETED) assert.ok(!text.includes(s), `${f} still holds: ${s}`);
  }
});
