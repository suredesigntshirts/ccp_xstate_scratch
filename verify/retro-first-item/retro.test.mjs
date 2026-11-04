// Verifier test for plan item retro-first-item, written by the verifier session. Offline: recomputes the item's
// token total and agent time from the committed session journal and checks the retro's table within 5%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const E = join(HERE, 'evidence');
const rows = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const session = rows(join(E, 'b61aac02-d158-42c9-bc6a-e013c1448ee0.jsonl'));
const item = rows(join(E, 'fri-jsonl-lint.jsonl'));
const retro = readFileSync(join(HERE, '..', '..', 'plan', 'research', 'retro-first-item.md'), 'utf8');

const sum = (t) => t.input + t.output + t.cacheRead + t.cacheCreation;
const within = (got, want) => Math.abs(got - want) / want <= 0.05;
const num = (s) => Number(s.replace(/,/g, ''));

// An agent can have several agent.finish rows with cumulative tokens and ms: take the last per agent.
const lastFinish = new Map();
for (const r of session.filter((r) => r.kind === 'agent.finish')) lastFinish.set(r.agent, r);
const driver = session.find((r) => r.kind === 'turn.usage').payload.tokens;

test('tokens: item total from turn.usage plus the last agent.finish per agent matches the retro table', () => {
  assert.equal(lastFinish.size, 3);
  const total = sum(driver) + [...lastFinish.values()].reduce((a, r) => a + sum(r.payload.tokens), 0);
  const row = retro.split('\n').find((l) => l.startsWith('| **item**'));
  const want = num(row.split('|').map((c) => c.trim().replace(/\*/g, '')).filter(Boolean).at(-1));
  assert.ok(within(total, want), `recomputed ${total}, retro ${want}`);
  assert.equal(total, 833859);
});

test('tokens: summing both finish rows of the brief agent would overcount by about 9%', () => {
  const all = session.filter((r) => r.kind === 'agent.finish');
  assert.equal(all.length, 4);
  const naive = sum(driver) + all.reduce((a, r) => a + sum(r.payload.tokens), 0);
  const over = naive - 833859;
  assert.equal(over, 76459);
  assert.match(retro, /76,459 tokens \(9%\)/);
});

test('agent time: last finish ms per agent sums to the 153.7 s the retro gives', () => {
  const ms = [...lastFinish.values()].reduce((a, r) => a + r.payload.ms, 0);
  const m = retro.match(/Agent time inside the working\s+span: ([\d.]+) s/);
  assert.ok(m, 'retro states agent time');
  assert.ok(within(ms / 1000, Number(m[1])), `recomputed ${ms / 1000}, retro ${m[1]}`);
});

test('rounds, asks and tool calls match the retro', () => {
  const transitions = item.filter((r) => r.kind === 'engine.transition');
  assert.deepEqual(transitions.map((r) => r.state), ['"briefing"', '"building"', '"verifying"', '"awaitingMerge"']);
  const verify = transitions.at(-1).payload.event.output;
  assert.equal(verify.result, 'PASS');
  assert.equal(session.filter((r) => r.kind === 'agent.spawn').length, 3);
  assert.equal(session.filter((r) => r.kind === 'tool.call').length, 27);
  const card = JSON.parse(readFileSync(join(E, 'card-3.ask.json'), 'utf8'));
  assert.equal(card.question, 'Merge this PR at the verified commit?');
});
