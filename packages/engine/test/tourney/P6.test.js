// P6 (stage-contract pack, lane S round 2): inputs carry meaning. Every input rendered to an agent comes with its
// declared meaning, null values included (a first build's previous, verdict and failure; a first brief's why). The
// task input (the brief agent's text) is not repeated under Inputs, and nothing reaches an agent undeclared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsOf, part, stageOf, taskInput, inputLine } from './contract.js';

test('P6: a first build shows previous, verdict and failure as null, each with its meaning', async () => {
  const p = await promptsOf();
  const { prompt } = p['qf.build'];
  const stage = stageOf('quick-fix', 'build');
  for (const k of ['previous', 'verdict', 'failure']) {
    assert.ok(stage.inputs[k].includes('null'), `${k}'s meaning says what null means`);
    assert.ok(part(prompt, 'Inputs').includes(`- ${k}: ${stage.inputs[k]}\n  = null`), `${k} renders with its meaning and null`);
  }
});

test('P6: every declared input of every stage appears with its meaning; the task input does not appear under Inputs', async () => {
  const p = await promptsOf();
  for (const [key, { prompt, run, workflow }] of Object.entries(p)) {
    const stage = stageOf(workflow, run.actor);
    const inputs = part(prompt, 'Inputs');
    const from = taskInput(stage);
    for (const [k, meaning] of Object.entries(stage.inputs)) {
      if (k === from) assert.ok(!inputs.includes(`- ${k}: `), `${key}: the task input ${k} is not under Inputs`);
      else assert.ok(inputs.includes(inputLine(k, meaning, run.input?.[k])), `${key}: ${k} with its meaning`);
    }
    // Nothing reaches the agent as an input without a declaration: every run input key is declared.
    for (const k of Object.keys(run.input ?? {})) assert.ok(k in stage.inputs, `${key}: run input ${k} is declared`);
  }
});

test('P6: the quick-fix brief shows why with its meaning, null on a first attempt', async () => {
  const p = await promptsOf();
  const why = stageOf('quick-fix', 'brief').inputs.why;
  assert.ok(why.includes('null'));
  assert.ok(part(p['qf.brief'].prompt, 'Inputs').includes(`- why: ${why}\n  = null`));
});
