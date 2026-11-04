// P6 Inputs carry meaning (stage contract, lane M): every input rendered to an agent comes with its meaning from the
// workflow, null retry inputs (verdict, failure, previous) on a first build included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsOf, section, lines } from './contract.js';

test('P6: a first build shows previous, verdict and failure with their meanings, each null', async () => {
  const p = await promptsOf();
  const { text, stage } = p['qf.build'];
  for (const k of ['previous', 'verdict', 'failure']) {
    assert.ok(lines(stage[k]).join(' ').length > 0);
    assert.ok(text.includes(`\n- ${k}: ${lines(stage[k]).join(' ')}\n  null\n`), `qf.build: ${k} with its meaning, then null`);
  }
  const w = p['rs.write'];
  assert.ok(w.text.includes(`\n- verdict: ${lines(w.stage.verdict).join(' ')}\n  null\n`), 'research\'s first write: verdict with its meaning, then null');
});

test('P6: every input key of every rendered stage appears with its JSON meaning, and no input appears without one', async () => {
  const p = await promptsOf();
  for (const [key, { text, run, stage }] of Object.entries(p)) {
    const inputs = `\n${section(text, '# Inputs') ?? ''}`;
    const given = Object.keys(run.input).filter((k) => k !== 'task');
    assert.deepEqual(given.sort(), Object.keys(stage).filter((k) => k !== 'task').sort(), `${key}: the run's inputs are the stage's meanings`);
    for (const k of given) assert.ok(inputs.includes(`\n- ${k}: ${lines(stage[k]).join(' ')}\n`), `${key}: ${k} with its meaning`);
    const rendered = [...inputs.matchAll(/^- ([\w-]+): /gm)].map((m) => m[1]);
    assert.deepEqual(rendered.sort(), given.sort(), `${key}: no input rendered without a meaning`);
  }
});
