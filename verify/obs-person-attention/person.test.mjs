// Verifier tests for plan item obs-person-attention (expect id "rows"). Fixture: fixture/tap-wake.txt is a decision-chosen
// wake copied by the verifier from the wf-quick-fix session's events (list_events, session_01KfkB5HZRbfGRGcZb4ar2mX, 16:54:27Z),
// not from the builder's fixture; fixture/message-wake.txt is the mention wake 3 s later, text replaced by a placeholder.
// The card call is written here from the card id the tap names. Everything runs through the real hook (capture.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attention } from '../../packages/journal/src/derive/attention.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..', '..', 'plugins', 'harness');
const FIX = (n) => readFileSync(join(HERE, 'fixture', n), 'utf8');
const THREAD = 'cmsg_01VhYV3jhQ9s4qrrh2th12sN8VmmfRj9W1iKvVYBXDUDjc';
const CARD = 'cmsg_01VhYV3jhQ9s4qrrh2th12sN7oo3Bm18DgfoRpQy3bR2XZ';
const MSG = 'cmsg_01VhYV3jhQ9s4qrrh2th12sNNzCoefJgRfizgykTpqVwnA';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-attn-'));
  const env = { ...process.env, CCP_HARNESS_DIR: join(dir, 'harness'), CCP_HARNESS_STATE: join(dir, 'state'), CLAUDE_CODE_REMOTE_SESSION_ID: '' };
  const inst = spawnSync('node', [join(PLUGIN, 'scripts', 'install.mjs')], { env, encoding: 'utf8' });
  assert.match(inst.stdout, /installed/);
  const fire = (input) => {
    const r = spawnSync('node', [join(PLUGIN, 'scripts', 'capture.mjs')], { env, input: JSON.stringify({ session_id: 'verify-attn', ...input }), encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  };
  const rows = () => {
    const d = join(env.CCP_HARNESS_DIR, 'journal', 'sessions');
    return readdirSync(d).flatMap((f) => readFileSync(join(d, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  };
  return { fire, rows, env };
}

const cardCall = {
  hook_event_name: 'PostToolUse',
  tool_name: 'mcp__hearthbot__request_decision',
  tool_input: { question: 'Q?', options: [{ label: 'a', consequence: 'x' }, { label: 'b', consequence: 'y' }], recommended: 0 },
  tool_response: [{ type: 'text', text: JSON.stringify({ message_id: CARD }) }],
  tool_use_id: 'toolu_verify_card',
  duration_ms: 50,
};

function run() {
  const h = harness();
  h.fire({ hook_event_name: 'UserPromptSubmit', prompt: FIX('message-wake.txt') });
  h.fire(cardCall);
  h.fire({ hook_event_name: 'UserPromptSubmit', prompt: FIX('tap-wake.txt') });
  return h;
}

test('fixture sanity: the tap envelope is a real decision-chosen wake naming the card', () => {
  const w = FIX('tap-wake.txt');
  assert.match(w, /<wake reason="decision-chosen"/);
  assert.ok(w.includes(`decision_id=${CARD}`));
  assert.ok(w.includes('option=A') && w.includes('option_index=0'));
});

test('rows: one message, one card, one tap yield three rows linked by card id (real hook)', () => {
  const rows = run().rows();
  const msg = rows.filter((r) => r.kind === 'person.message');
  const card = rows.filter((r) => r.kind === 'card.posted');
  const tap = rows.filter((r) => r.kind === 'person.tap');
  assert.equal(msg.length, 1);
  assert.equal(card.length, 1);
  assert.equal(tap.length, 1);
  assert.equal(msg[0].payload.messageId, MSG);
  assert.equal(msg[0].payload.thread, THREAD);
  assert.equal(card[0].payload.cardId, CARD);
  assert.equal(tap[0].payload.cardId, CARD);
  assert.equal(card[0].source.ref, CARD);
  assert.equal(tap[0].source.ref, CARD);
  assert.equal(card[0].payload.thread, THREAD, 'card takes the thread of the last wake');
  assert.equal(tap[0].payload.thread, THREAD);
  assert.equal(tap[0].payload.option, 'A');
  assert.equal(tap[0].payload.optionIndex, 0);
  assert.equal(tap[0].payload.sentAt, '2026-10-30T16:54:27Z');
  assert.equal(card[0].payload.options, 2);
  // the tap wake does not also make a person.message
  assert.equal(rows.filter((r) => r.kind === 'person.message').length, 1);
});

test('rows: no row holds what the person wrote or the card said', () => {
  const text = JSON.stringify(run().rows());
  assert.ok(!text.includes('Chose'));
  assert.ok(!text.includes('left out of the repo'));
  assert.ok(!text.includes('Q?'));
});

test('rows: the attention view links the three by card id; wait = tap sentAt - card row time', () => {
  const rows = run().rows();
  const v = attention(rows);
  assert.equal(v.cards.length, 1);
  const c = v.cards[0];
  assert.equal(c.cardId, CARD);
  assert.ok(c.postedAt && c.tappedAt === '2026-10-30T16:54:27Z');
  assert.equal(c.waitMs, Date.parse(c.tappedAt) - Date.parse(c.postedAt));
  assert.equal(v.threads[THREAD].messages, 1);
  assert.equal(v.threads[THREAD].taps, 1);
  assert.equal(v.threads[THREAD].cards, 1);
});

test('rows: replaying the same wake does not double count a message in the view', () => {
  const h = run();
  h.fire({ hook_event_name: 'UserPromptSubmit', prompt: FIX('message-wake.txt') });
  const v = attention(h.rows());
  assert.equal(v.threads[THREAD].messages, 1);
});

test('rows: a post_message call makes a post.sent row in the same thread', () => {
  const h = run();
  h.fire({ hook_event_name: 'PostToolUse', tool_name: 'mcp__hearthbot__post_message', tool_input: { text: 'hello' }, tool_response: [{ type: 'text', text: JSON.stringify({ message_id: 'cmsg_post1', thread_id: THREAD }) }], tool_use_id: 't2' });
  const post = h.rows().filter((r) => r.kind === 'post.sent');
  assert.equal(post.length, 1);
  assert.equal(post[0].payload.thread, THREAD);
  assert.equal(post[0].payload.messageId, 'cmsg_post1');
});
