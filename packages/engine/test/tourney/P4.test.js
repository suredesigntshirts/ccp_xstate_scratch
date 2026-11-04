// P4 Brief fills task only (stage contract, lane M): the build and verify prompts (and research's researcher, writer
// and verifier) hold the brief agent's text only inside the task part; role and limits, inputs, output and return are
// still rendered from the workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsOf, FRAME, FIX, resolve, section, lines } from './contract.js';

const count = (text, s) => text.split(s).length - 1;

test('P4: each brief lands once, inside # Task; every other part comes from the workflow', async () => {
  const p = await promptsOf();
  const cases = { 'qf.build': FIX.builder, 'qf.verify': FIX.verifier, 'rs.researcher': FIX.researcher, 'rs.write': FIX.writer, 'rs.verify': FIX.rverifier };
  for (const [key, brief] of Object.entries(cases)) {
    const { text, stage, schema, defs, run } = p[key];
    assert.equal(count(text, brief), 1, `${key}: the brief occurs exactly once`);
    assert.equal(section(text, '# Task').trim(), brief, `${key}: the task part is the brief and only the brief`);
    for (const other of Object.values(FIX)) if (other !== brief) assert.equal(count(text, other), 0, `${key}: no other brief`);
    assert.equal(section(text, '# Rules').trim(), [FRAME.rules, `- ${FRAME.data}`, ...lines(stage.task).map((l) => `- ${l}`)].join('\n'), `${key}: rules are the workflow's`);
    const inputs = section(text, '# Inputs');
    for (const [k, m] of Object.entries(stage)) if (k !== 'task') assert.ok(inputs.includes(`- ${k}: ${lines(m).join(' ')}\n`), `${key}: input ${k} with its JSON meaning`);
    assert.ok(!inputs.includes(brief), `${key}: the brief is not an input`);
    assert.equal(section(text, '# Output').trim(), `${FRAME.output}\n${JSON.stringify(resolve(schema, defs), null, 2)}`, `${key}: output is the workflow's schema`);
    assert.ok(FRAME.ret.test(section(text, '# Return')), `${key}: return is present`);
    assert.ok(section(text, '# Return').includes(`"run": "${run.run}"`));
  }
  assert.notEqual(section(p['qf.verify'].text, '# Rules'), section(p['qf.build'].text, '# Rules'), 'the verify prompt\'s rules are not the build prompt\'s');
  assert.notEqual(section(p['rs.write'].text, '# Rules'), section(p['rs.researcher'].text, '# Rules'), 'research\'s writer and researcher get their own rules');
});
