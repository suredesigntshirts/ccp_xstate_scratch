// P2 (stage-contract pack): no prompt wording in engine code. Every line of every rendered prompt traces to the
// workflow JSON (the stage's parts, the run's input values, the actor's schema) or to the renderer's fixed frame,
// a short allowlist. And none of the control's engine-held agent wording is left in packages/engine/src.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_RULE, HEADINGS, returnLine, runLine } from '../../src/stages.js';
import { promptsOf, WORKFLOWS } from './contract.js';

// The test's own $ref inliner, so the Schema line is checked against the JSON, not against the renderer's helper.
const inlined = (s, defs) => (s && typeof s === 'object'
  ? (s.$ref ? inlined(defs[s.$ref.replace(/^#/, '')], defs) : Array.isArray(s) ? s.map((x) => inlined(x, defs)) : Object.fromEntries(Object.entries(s).map(([k, v]) => [k, inlined(v, defs)])))
  : s);

const lines = (s) => String(s).split('\n');

/** Every line a prompt may have, from the JSON and the frame. */
function allowed({ run, workflow }) {
  const wf = WORKFLOWS[workflow];
  const stage = wf.meta.stages[run.actor];
  const ok = new Set(['', '(none)', ...Object.values(HEADINGS), DATA_RULE, ...lines(returnLine(run.run)), runLine(run)]);
  for (const l of lines(stage.role)) ok.add(l);
  for (const l of lines(stage.return)) ok.add(l);
  for (const l of stage.limits) ok.add(`- ${l}`);
  for (const [k, f] of Object.entries(stage.inputs)) {
    ok.add(`- ${k} (${f.trust}): ${f.meaning}`);
    ok.add(`  = ${JSON.stringify(run.input?.[k] ?? null)}`);
  }
  for (const [k, f] of Object.entries(stage.output)) ok.add(`- ${k}: ${f.meaning}`);
  ok.add(`Schema: ${JSON.stringify(inlined(wf.meta.actors[run.actor], wf.meta.schemas ?? {}))}`);
  const task = typeof stage.task === 'string' ? stage.task : run.input[stage.task.input];
  for (const l of lines(task)) ok.add(l);
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

test('P2: the frame\'s five-plus-word wording is only the data rule and the return line; the role printed is the JSON\'s', async () => {
  // The fixed frame's five-plus-word wording is two strings: the data rule and the return line.
  const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;
  const frame = [...Object.values(HEADINGS), '(none)', runLine({ run: 'r', worktree: 'w', branch: 'b' })];
  for (const f of frame) assert.ok(words(f) < 5, `${f} is under five words`);
  assert.ok(words(DATA_RULE) >= 5 && words(returnLine('r')) >= 5);
  // Wording is read from the JSON: the role printed is the JSON role, not engine text.
  const p = await promptsOf();
  for (const [key, { prompt, run, workflow }] of Object.entries(p)) {
    const stage = WORKFLOWS[workflow].meta.stages[run.actor];
    assert.ok(prompt.startsWith(`## Role\n${stage.role}\n`), `${key} role comes from the JSON`);
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
