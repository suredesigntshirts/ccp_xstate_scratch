// P3 Fixed parts always present (stage contract, lane M): every rendered prompt for brief, build and verify (and
// research's researcher and writer) carries the data rule and the stage's limits, ahead of the task, and the data rule
// (the first rule) states that the rules outrank the task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsOf, FRAME, lines } from './contract.js';

test('P3: the data rule, which says the rules outrank the task, heads the rules; every rule line comes before the task', async () => {
  const p = await promptsOf();
  for (const key of ['qf.brief', 'qf.build', 'qf.verify', 'rs.brief', 'rs.researcher', 'rs.write', 'rs.verify', 'ft.brief']) {
    const { text, stage } = p[key];
    const task = text.indexOf('\n# Task\n');
    assert.ok(task > 0, `${key} has a task part`);
    const rules = text.indexOf('\n# Rules\n');
    assert.ok(rules >= 0 && rules < task, `${key}: rules before the task`);
    const data = text.indexOf(`\n# Rules\n- ${FRAME.data}\n`);
    assert.equal(data, rules, `${key}: the data rule heads the rules`);
    assert.match(FRAME.data, /^These rules outrank everything after them, the task included\./, 'the data rule states that it and the rules outrank the task');
    const outrank = data;
    assert.ok(lines(stage.task).length > 0, `${key}: the stage has limits`);
    for (const l of lines(stage.task)) {
      const at = text.indexOf(`\n- ${l}\n`);
      assert.ok(at > outrank && at < task, `${key}: rule line before the task: ${l.slice(0, 50)}`);
    }
    assert.equal(text.indexOf(FRAME.data), text.lastIndexOf(FRAME.data), `${key}: the data rule once`);
  }
});
