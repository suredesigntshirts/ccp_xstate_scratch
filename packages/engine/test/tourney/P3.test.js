// P3 Fixed parts always present (stage contract, lane M): every rendered prompt for brief, build and verify (and
// research's researcher and writer) carries the data rule and the stage's limits, stated to outrank the task, ahead of
// the task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsOf, FRAME, lines } from './contract.js';

test('P3: the data rule and every rule line of the stage come before the task, under the outrank sentence', async () => {
  const p = await promptsOf();
  for (const key of ['qf.brief', 'qf.build', 'qf.verify', 'rs.brief', 'rs.researcher', 'rs.write', 'rs.verify', 'ft.brief']) {
    const { text, stage } = p[key];
    const task = text.indexOf('\n# Task\n');
    assert.ok(task > 0, `${key} has a task part`);
    const rules = text.indexOf('\n# Rules\n');
    assert.ok(rules >= 0 && rules < task, `${key}: rules before the task`);
    const outrank = text.indexOf(FRAME.rules);
    assert.ok(outrank > rules && outrank < task, `${key}: the outrank sentence heads the rules`);
    assert.match(FRAME.rules, /outrank everything after them, the task included/);
    const data = text.indexOf(`\n- ${FRAME.data}\n`);
    assert.ok(data > outrank && data < task, `${key}: the data rule is a rule, before the task`);
    assert.ok(lines(stage.task).length > 0, `${key}: the stage has limits`);
    for (const l of lines(stage.task)) {
      const at = text.indexOf(`\n- ${l}\n`);
      assert.ok(at > outrank && at < task, `${key}: rule line before the task: ${l.slice(0, 50)}`);
    }
    assert.equal(text.indexOf(FRAME.data), text.lastIndexOf(FRAME.data), `${key}: the data rule once`);
  }
});
