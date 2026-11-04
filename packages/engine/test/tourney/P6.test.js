// P6 (stage-contract pack): inputs carry meaning. Every input rendered to an agent comes with its declared meaning
// and trust, null values included (a first build's previous, verdict and failure; a first brief's why). The task
// input (the brief agent's text) is not repeated under Inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsOf, part, WORKFLOWS } from './contract.js';

test('P6: a first build shows previous, verdict and failure as null, each with its meaning', async () => {
  const p = await promptsOf();
  const { prompt } = p['qf.build'];
  const stage = WORKFLOWS['quick-fix'].meta.stages.build;
  for (const k of ['previous', 'verdict', 'failure']) {
    assert.ok(stage.inputs[k].meaning.includes('null'), `${k}'s meaning says what null means`);
    assert.ok(part(prompt, 'Inputs').includes(`- ${k} (data): ${stage.inputs[k].meaning}\n  = null`), `${k} renders with its meaning and null`);
  }
});

test('P6: every declared input of every stage appears with its meaning and trust; the task input does not appear under Inputs', async () => {
  const p = await promptsOf();
  for (const [key, { prompt, run, workflow }] of Object.entries(p)) {
    const stage = WORKFLOWS[workflow].meta.stages[run.actor];
    const inputs = part(prompt, 'Inputs');
    const from = typeof stage.task === 'object' ? stage.task.input : null;
    for (const [k, f] of Object.entries(stage.inputs)) {
      const line = `- ${k} (${f.trust}): ${f.meaning}\n  = ${JSON.stringify(run.input?.[k] ?? null)}`;
      if (k === from) assert.ok(!inputs.includes(`- ${k} (`), `${key}: the task input ${k} is not under Inputs`);
      else assert.ok(inputs.includes(line), `${key}: ${k} with its meaning`);
    }
    // Nothing reaches the agent as an input without a declaration: every run input key is declared.
    for (const k of Object.keys(run.input ?? {})) assert.ok(k in stage.inputs, `${key}: run input ${k} is declared`);
  }
});

test('P6: the quick-fix brief shows why as instructions, null on a first attempt', async () => {
  const p = await promptsOf();
  const why = WORKFLOWS['quick-fix'].meta.stages.brief.inputs.why;
  assert.equal(why.trust, 'instructions');
  assert.ok(part(p['qf.brief'].prompt, 'Inputs').includes(`- why (instructions): ${why.meaning}\n  = null`));
});
