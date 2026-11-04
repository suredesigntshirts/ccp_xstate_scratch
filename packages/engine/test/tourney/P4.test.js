// P4 (stage-contract pack): the brief fills the Task part only. Build and verify (and research's researcher, writer
// and verifier) get the brief agent's text exactly as their Task part, once, and nowhere else; their role, inputs,
// limits, output and return are still the workflow's. The brief agent's text is never the whole prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from '../../../journal/src/index.js';
import { promptsOf, part, WORKFLOWS, BRIEFS, PLAN } from './contract.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;

// The parts a stage's JSON gives, formatted as the contract prints them (the test's own formatting).
function expected(workflow, run) {
  const stage = WORKFLOWS[workflow].meta.stages[run.actor];
  const from = stage.task.input;
  return {
    Role: stage.role,
    Inputs: Object.entries(stage.inputs).filter(([k]) => k !== from)
      .map(([k, f]) => `- ${k} (${f.trust}): ${f.meaning}\n  = ${JSON.stringify(run.input[k] ?? null)}`).join('\n'),
    Limits: stage.limits.map((l) => `- ${l}`),
    Output: Object.entries(stage.output).map(([k, f]) => `- ${k}: ${f.meaning}`),
    Return: stage.return
  };
}

const CASES = [
  ['qf.build', 'MARK-B', BRIEFS.builder],
  ['qf.verify', 'MARK-V', BRIEFS.verifier],
  ['rs.researcher', 'MARK-R', PLAN.researcher],
  ['rs.writer', 'MARK-W', PLAN.writer],
  ['rs.verify', 'MARK-RV', PLAN.verifier]
];

test('P4: each brief appears once, as the whole Task part, and the other parts are the workflow\'s', async () => {
  const p = await promptsOf();
  for (const [key, mark, brief] of CASES) {
    const { prompt, run, workflow } = p[key];
    assert.equal(count(prompt, mark), 1, `${key}: ${mark} once`);
    const task = prompt.indexOf('\n## Task\n');
    const output = prompt.indexOf('\n## Output\n', task);
    const at = prompt.indexOf(mark);
    assert.ok(task < at && at < output, `${key}: ${mark} sits inside the Task part`);
    assert.equal(part(prompt, 'Task'), brief, `${key}: the Task part is the brief exactly`);
    assert.notEqual(prompt, brief, `${key}: the brief is not the whole prompt`);
    const want = expected(workflow, run);
    assert.ok(prompt.startsWith(`## Role\n${want.Role}\n\n## Limits\n`), `${key}: Role is the JSON's`);
    assert.equal(part(prompt, 'Inputs'), want.Inputs, `${key}: Inputs (without the brief) are the JSON's`);
    assert.deepEqual(part(prompt, 'Limits').split('\n').slice(1), want.Limits, `${key}: Limits are the data rule and the JSON's`);
    assert.deepEqual(part(prompt, 'Output').split('\n').slice(0, -1), want.Output, `${key}: Output meanings are the JSON's`);
    assert.equal(part(prompt, 'Return').split('\n')[0], want.Return, `${key}: Return is the JSON's`);
    assert.ok(!part(prompt, 'Inputs').includes(mark), `${key}: the brief is not repeated under Inputs`);
  }
});

test('P4: the verifier brief fixed at the brief agent\'s accept is exactly the verify run\'s Task part, and the run journals its whole prompt', async () => {
  const p = await promptsOf();
  const { prompt, run, root, item } = p['qf.verify'];
  const rows = readFile(join(root, 'items', `${item}.jsonl`)).rows;
  const fixed = rows.find((r) => r.kind === 'brief.stored' && r.payload.role === 'verifier');
  assert.equal(fixed.payload.hash, sha256(part(prompt, 'Task')));
  const own = rows.find((r) => r.kind === 'brief.stored' && r.payload.run === run.run);
  assert.equal(own.payload.hash, sha256(prompt));
  assert.equal(run.briefHash, sha256(prompt));
});
