// Verifier tests for plan item engine-toy-run, written by the verifier session (not the builder). Offline: they read
// the committed evidence of the verifier's own rerun (item toy-v1, scratch PR #26) in verify/engine-toy-run/evidence/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E = join(dirname(fileURLToPath(import.meta.url)), 'evidence');
const SESSION = '4a54715a-cd89-4d82-8b17-baefea4cf3a6';
const jsonl = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const item = jsonl(join(E, 'item-toy-v1.jsonl'));
const session = jsonl(join(E, `session-${SESSION}.jsonl`));
const pr = JSON.parse(readFileSync(join(E, 'github-pr-26.json'), 'utf8'));
const card = JSON.parse(readFileSync(join(E, 'card-3.ask.json'), 'utf8'));

test('merged: GitHub shows the toy PR merged at the sha the verify run passed', () => {
  assert.equal(pr.merged, true);
  assert.equal(pr.state, 'closed');
  const verify = item.find((r) => r.kind === 'engine.transition' && r.payload.event.type === 'xstate.done.actor.verify');
  const verdict = verify.payload.event.output;
  assert.equal(verify.payload.outcome, 'applied');
  assert.equal(verdict.result, 'PASS');
  assert.equal(verdict.sha, pr.head.sha);
  assert.match(pr.body, /Closes https:\/\/github\.com\/suredesigntshirts\/ccp_xstate_scratch\/issues\/25/);
});

test('merged: the journal has the engine.effect merge done row, at that sha, and GitHub bears it out', () => {
  const done = item.filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge' && r.payload.phase === 'done');
  assert.equal(done.length, 1);
  const o = done[0].payload.outcome;
  assert.equal(o.number, 26);
  assert.equal(o.head, pr.head.sha);
  assert.equal(o.sha, pr.merge_commit_sha);
  assert.equal(done[0].source.system, 'engine');
});

test('complete: every tool_use in the driver and agent transcripts has a tool.call row, and no row lacks a call', () => {
  const files = [join(E, 'transcripts', `${SESSION}.jsonl`), ...readdirSync(join(E, 'transcripts', 'subagents')).filter((f) => f.endsWith('.jsonl')).map((f) => join(E, 'transcripts', 'subagents', f))];
  assert.equal(files.length, 4);
  const calls = new Map();
  for (const f of files) for (const r of jsonl(f)) for (const b of Array.isArray(r.message?.content) ? r.message.content : []) if (b.type === 'tool_use') calls.set(b.id, b.name);
  const rows = session.filter((r) => r.kind === 'tool.call');
  assert.equal(calls.size, 25);
  assert.equal(rows.length, 25);
  for (const [id, name] of calls) {
    const row = rows.find((r) => r.source.ref === id);
    assert.ok(row, `no journal row for ${name} ${id}`);
    assert.equal(row.payload.tool, name);
  }
  for (const r of rows) assert.ok(calls.has(r.source.ref), `journal row ${r.source.ref} has no call in the logs`);
});

test('complete: the resumed tap turn is in the logs and its call is journalled', () => {
  const main = jsonl(join(E, 'transcripts', `${SESSION}.jsonl`));
  const tapPrompt = main.findIndex((r) => r.type === 'user' && typeof r.message?.content === 'string' && r.message.content.includes('decision-chosen'));
  assert.ok(tapPrompt > 0);
  const after = main.slice(tapPrompt).flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : [])).filter((b) => b.type === 'tool_use');
  assert.ok(after.length >= 1);
  for (const b of after) assert.ok(session.some((r) => r.kind === 'tool.call' && r.source.ref === b.id));
});

test('sources: every engine.transition row is a wake, a completion or a timer', () => {
  const rows = item.filter((r) => r.kind === 'engine.transition');
  assert.equal(rows.length, 6);
  const klass = (r) => {
    if (r.payload.event.type === 'xstate.init') return 'start';
    const s = r.source.system;
    if (s === 'harness' || s === 'engine') return 'completion';
    if (s === 'hearth' || s === 'github') return 'wake';
    if (s === 'timer') return 'timer';
    return 'OTHER';
  };
  assert.deepEqual(rows.map(klass), ['start', 'completion', 'completion', 'completion', 'wake', 'completion']);
  assert.deepEqual(rows.map((r) => r.payload.seq), [0, 1, 2, 3, 4, 5]);
  // The one non-wake/completion/timer row is seq 0: the driver's own session filing the item (source claude-code, ref = that session).
  assert.equal(rows[0].source.system, 'claude-code');
  assert.equal(rows[0].source.ref, SESSION);
  assert.equal(rows[0].session, SESSION);
});

test('sources: completions come from the return hook or the engine effect, not from an agent saying so', () => {
  const rows = item.filter((r) => r.kind === 'engine.transition');
  for (const r of rows.slice(1, 4)) {
    assert.equal(r.source.system, 'harness');
    assert.ok(item.concat(session).some((x) => x.kind === 'result.stored'));
  }
  assert.equal(rows[5].source.system, 'engine');
  assert.equal(rows[5].source.ref, 'toy-v1:4.merge');
});

test('sources: the tap row names the card the thread recorded, and the session saw the tap wake', () => {
  const tap = item.find((r) => r.kind === 'engine.transition' && r.source.system === 'hearth');
  assert.equal(tap.source.ref, card.ref);
  assert.equal(card.effect, 'toy-v1:4.ask'.replace(':4.', ':3.'));
  const person = session.find((r) => r.kind === 'person.tap');
  assert.equal(person.payload.cardId, card.ref);
  assert.equal(person.payload.option, 'A');
  const wake = session.find((r) => r.kind === 'wake' && r.payload.reason === 'decision-chosen');
  assert.equal(wake.payload.source, 'hearth');
  const merge = item.find((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge' && r.payload.phase === 'start');
  assert.ok(Date.parse(merge.at) > Date.parse(wake.at) - 1000);
});
