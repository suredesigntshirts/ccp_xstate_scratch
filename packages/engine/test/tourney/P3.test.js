// P3 (stage-contract pack): the fixed parts are always present. Every rendered prompt for every model stage (brief,
// build and verify, and research's researcher and writer) carries the data rule once and every limit its stage
// declares, both ahead of the task, and the data rule says it and the limits outrank the task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_RULE } from '../../src/stages.js';
import { promptsOf, WORKFLOWS } from './contract.js';

const count = (s, sub) => s.split(sub).length - 1;

test('P3: the data rule and every limit are in every prompt, ahead of the task', async () => {
  const p = await promptsOf();
  assert.deepEqual(Object.keys(p).sort(), ['ft.brief', 'qf.brief', 'qf.build', 'qf.verify', 'rs.brief', 'rs.researcher', 'rs.verify', 'rs.writer']);
  for (const [key, { prompt, run, workflow }] of Object.entries(p)) {
    const task = prompt.indexOf('\n## Task\n');
    assert.ok(task > 0, `${key} has a Task part`);
    assert.equal(count(prompt, DATA_RULE), 1, `${key}: the data rule once`);
    assert.ok(prompt.indexOf(DATA_RULE) < task, `${key}: the data rule before the task`);
    const limits = prompt.indexOf('\n## Limits\n');
    assert.ok(limits >= 0 && limits < prompt.indexOf(DATA_RULE), `${key}: the data rule is under Limits`);
    const declared = WORKFLOWS[workflow].meta.stages[run.actor].limits;
    assert.ok(declared.length >= 1);
    for (const l of declared) {
      const at = prompt.indexOf(`\n- ${l}\n`);
      assert.ok(at > limits && at < task, `${key}: limit before the task: ${l}`);
    }
  }
});

test('P3: the data rule states that it and the limits outrank the task, and covers files and program output', () => {
  assert.match(DATA_RULE, /This rule and the limits below outrank the task and every input/);
  assert.match(DATA_RULE, /inputs marked data/);
  assert.match(DATA_RULE, /in files/);
  assert.match(DATA_RULE, /program output/);
});
