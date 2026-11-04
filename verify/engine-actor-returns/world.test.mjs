// World line `real`, scratch items ar2 (issue #31, before the handback fix, at 51eced2) and ar4 (issue #33, at c4d87a8),
// from the committed evidence: the agents are told to end with SubagentHandback and never call the return tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E = join(dirname(fileURLToPath(import.meta.url)), 'evidence');
const read = (f) => readFileSync(join(E, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const types = (rows) => rows.filter((r) => r.kind === 'engine.transition').map((r) => r.payload.event.type);

test('ar2 at 51eced2 (old code): the block came after the handback, nothing failed, the item stayed in briefing', () => {
  const rows = read('item-ar2.jsonl');
  assert.equal(rows.filter((r) => r.payload?.rule === 'no-return').length, 0);
  assert.deepEqual(types(rows), ['xstate.init']);
});

test('ar4 at c4d87a8: first SubagentHandback denied no-return, second goes through and fails the run, the item leaves briefing, no person', () => {
  const rows = read('item-ar4.jsonl');
  const agent = JSON.parse(readFileSync(join(E, 'ar4-agent-handbacks.json'), 'utf8'));
  assert.equal(agent.filter((a) => a.tool_use).length, 2, 'two handbacks');
  assert.match(agent.find((a) => a.tool_result && /no-return/.test(a.tool_result)).tool_result, /harness__return/);
  assert.match(agent.at(-1).tool_result, /Report delivered/);
  const refusal = rows.find((r) => r.kind === 'refusal' && r.payload.rule === 'no-return');
  assert.equal(refusal.payload.tool, 'SubagentHandback');
  const t = rows.filter((r) => r.kind === 'engine.transition');
  assert.deepEqual(t.map((r) => r.payload.event.type), ['xstate.init', 'xstate.error.actor.brief']);
  assert.equal(t[1].source.system, 'harness');
  assert.equal(t[1].payload.outcome, 'applied');
  assert.equal(t[1].payload.from, '"briefing"');
  assert.notEqual(t[1].state, '"briefing"');
  assert.ok(!rows.some((r) => r.source?.system === 'hearth'), 'no person');
});
