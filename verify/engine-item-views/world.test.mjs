// World lines `tagged` and `view`: scratch toy run iv1 (issue #34, PR #35 closed unmerged) at 8755478, from the slimmed
// journal in evidence/iv1-journal.jsonl (tool.call payloads cut to tool and ok). The card was recorded with a made-up id
// (cmsg_verifier_iv1_standin; the verifier cannot post a real card) and answered by a stand-in under the grant.
// Hand counts from the rows: agents 96,818 (brief, last of 71,192 and 96,818) + 151,371 + 156,267 = 404,456; the driver's
// turn.usage 224,449; item 628,905. Card recorded 04:10:28.042, answered 04:10:34.299 = 6.257 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemView } from '../../plugins/harness/pages/observe/data.js';

const E = join(dirname(fileURLToPath(import.meta.url)), 'evidence');
const rows = readFileSync(join(E, 'iv1-journal.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const shown = JSON.parse(readFileSync(join(E, 'browser-check-iv1.json'), 'utf8')).shown;

test('tagged: every tool.call from the item\'s three agents carries item iv1 and its step\'s state', () => {
  const spawned = rows.filter((r) => r.kind === 'agent.spawn' && r.item === 'iv1');
  assert.equal(spawned.length, 3);
  const calls = rows.filter((r) => r.kind === 'tool.call' && r.agent);
  assert.equal(calls.length, 17);
  const stateOf = new Map(spawned.map((r) => [r.agent, r.state]));
  assert.deepEqual([...stateOf.values()].sort(), ['"briefing"', '"building"', '"verifying"']);
  for (const c of calls) {
    assert.equal(c.item, 'iv1');
    assert.equal(c.state, stateOf.get(c.agent), `${c.agent} ${c.id}`);
  }
  assert.ok(rows.filter((r) => r.kind === 'agent.finish').every((r) => r.item === 'iv1'));
});

test('view: the item view\'s state, tokens and person wait equal the hand counts from the rows', () => {
  const v = itemView(rows, 'iv1');
  assert.equal(v.state, 'replanning');
  assert.equal(v.tokens.agents.total, 96818 + 151371 + 156267);
  assert.equal(v.tokens.sessions.total, 224449);
  assert.equal(v.tokens.total.total, 628905);
  assert.equal(v.personWaitMs, Date.parse('2026-10-31T04:10:34.299Z') - Date.parse('2026-10-31T04:10:28.042Z'));
  assert.equal(v.personWaitMs, 6257);
  assert.equal(v.asks[0].by, 'standin');
  assert.equal(v.asks[0].choice, 'reject');
  assert.equal(v.rounds, 1);
});

test('view: the page (Chromium, browser-check.mjs --item iv1) showed the same', () => {
  assert.equal(shown['item-state'], 'replanning · 628,905 tokens');
  assert.match(shown['item-sub'], /waited on the person 6s/);
  assert.deepEqual(shown['item-rows'].find((r) => r[0] === 'Agents'), ['Agents', '404,456 tokens over 3 agents']);
});
