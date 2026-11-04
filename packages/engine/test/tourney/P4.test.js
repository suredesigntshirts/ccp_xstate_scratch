// P4 (stage-contract pack, lane S round 2): the brief fills the Task part only. Build and verify (and research's
// researcher, writer and verifier) get the brief agent's text exactly as their Task part, once, and nowhere else;
// their rules, inputs, output and return are still the workflow's. The brief agent's text is never the whole prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from '../../../journal/src/index.js';
import { DATA_RULE, WORKTREE_RULE, returnLine } from '../../src/stages.js';
import { promptsOf, part, stageOf, taskInput, inputLine, schemaLine, outputLines, BRIEFS, PLAN } from './contract.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;

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
    const stage = stageOf(workflow, run.actor);
    const from = taskInput(stage);
    assert.ok(from, `${key}: the task names an input`);
    assert.equal(count(prompt, mark), 1, `${key}: ${mark} once`);
    const task = prompt.indexOf('\n## Task\n');
    const output = prompt.indexOf('\n## Output\n', task);
    const at = prompt.indexOf(mark);
    assert.ok(task < at && at < output, `${key}: ${mark} sits inside the Task part`);
    assert.equal(part(prompt, 'Task'), brief, `${key}: the Task part is the brief exactly`);
    assert.notEqual(prompt, brief, `${key}: the brief is not the whole prompt`);
    assert.equal(part(prompt, 'Rules'), [DATA_RULE, WORKTREE_RULE, ...stage.rules.map((r) => `- ${r}`)].join('\n'), `${key}: Rules are the frame's two rules and the JSON's`);
    const inputs = Object.entries(stage.inputs).filter(([k]) => k !== from).map(([k, m]) => inputLine(k, m, run.input[k])).join('\n');
    assert.equal(part(prompt, 'Inputs'), inputs, `${key}: Inputs (without the brief) are the JSON's`);
    assert.equal(part(prompt, 'Output'), [...outputLines(workflow, run.actor), schemaLine(workflow, run.actor)].join('\n'), `${key}: Output is the JSON's`);
    assert.equal(part(prompt, 'Return').split('\n')[0], returnLine(run.run), `${key}: Return is the frame's`);
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
