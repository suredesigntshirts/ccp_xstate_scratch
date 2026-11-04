// Person rows (plan item obs-person-attention): a real tap wake, a real message wake and the hearthbot calls that put
// a card or a post in front of the person, through the handlers and through the hook as Claude Code runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN, runHook, temp } from './helpers.mjs';
import { personOf, posted, sha256 } from '../scripts/capture-rows.mjs';
import { readFile } from '../../../packages/journal/src/index.js';
import { attention } from '../../../packages/journal/src/derive/attention.js';

const FIX = join(PLUGIN, 'test', 'fixtures', 'attention');
const text = (name) => readFileSync(join(FIX, name), 'utf8');
const json = (name) => JSON.parse(text(name));
const HOOK = join(PLUGIN, 'scripts', 'capture.mjs');
const THREAD = 'cmsg_01VhYV3jhQ9s4qrrh2th12sN8VmmfRj9W1iKvVYBXDUDjc';
const CARD = 'cmsg_01VhYV3jhQ9s4qrrh2th12sN7oo3Bm18DgfoRpQy3bR2XZ';

test('a tap wake is one person.tap naming the card, the option and the thread', () => {
  const { thread, rows } = personOf(text('tap-wake.txt'));
  assert.equal(thread, THREAD);
  assert.deepEqual(rows, [{
    kind: 'person.tap',
    source: { system: 'hearth', ref: CARD },
    agent: null,
    payload: { thread: THREAD, cardId: CARD, option: 'A', optionIndex: 0, sentAt: '2026-10-30T16:54:27Z', authorId: 'user_01KfkB5Jm6bszTAytbWYG5at' },
  }]);
});

test('a message wake is one person.message with its id, and keeps a hash of the text, not the text', () => {
  const wake = text('message-wake.txt');
  const { rows } = personOf(wake);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.kind, 'person.message');
  assert.deepEqual(row.source, { system: 'hearth', ref: 'cmsg_01VhYV3jhQ9s4qrrh2th12sNNzCoefJgRfizgykTpqVwnA' });
  assert.equal(row.payload.thread, THREAD);
  assert.equal(row.payload.reason, 'mention');
  assert.equal(row.payload.sentAt, '2026-10-30T16:54:30Z');
  const body = "[The person's text is left out of the repo; the row keeps only its hash and size.]";
  assert.equal(row.payload.hash, sha256(body));
  assert.ok(!JSON.stringify(row).includes('left out of the repo'));
});

test('wakes with no person in them make no person rows', () => {
  const relay = `<wake reason="spawn" current-time="x"><project id="p"><thread ts="t1"><message trigger="true" from="system" trust="principal">go</message></thread></project></wake>
<coordinator-relay><cited id="c1" author="user" name="P">copied</cited></coordinator-relay>`;
  assert.deepEqual(personOf(relay), { thread: 't1', rows: [] });
  assert.deepEqual(personOf('<task-notification>x</task-notification>'), { thread: null, rows: [] });
  assert.deepEqual(posted({ tool_name: 'Bash', tool_input: {}, tool_response: {} }), []);
  assert.deepEqual(posted({ tool_name: 'mcp__hearthbot__update_progress_checklist', tool_input: {}, tool_response: [] }), []);
});

test('request_decision is a card.posted keyed by the card id, in the thread the session was woken in', () => {
  const [row] = posted(json('card-input.json'), { thread: THREAD });
  assert.equal(row.kind, 'card.posted');
  assert.deepEqual(row.source, { system: 'hearth', ref: CARD });
  assert.deepEqual({ ...row.payload, inputHash: undefined, inputBytes: undefined }, { thread: THREAD, cardId: CARD, card: 'decision', options: 3, recommended: 0, inputHash: undefined, inputBytes: undefined });
  assert.ok(!JSON.stringify(row).includes('headless demo'));
});

test('post_message is a post.sent with the message and thread ids hearthbot returned', () => {
  const [row] = posted(json('post-message-input.json'), { thread: 'other' });
  assert.equal(row.kind, 'post.sent');
  assert.deepEqual(row.payload, { thread: 'cmsg_THREAD', messageId: 'cmsg_TEST', hash: sha256('hi'), bytes: 2, attached: 0 });
});

test('the hook journals message, card and tap linked by the card id, with the card wait from post to tap', () => {
  const dir = temp('person');
  execFileSync(process.execPath, [join(PLUGIN, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir } });
  const env = { CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: join(dir, 'state') };
  const session = 'attention-fixture';
  const wake = (prompt) => ({ session_id: session, hook_event_name: 'UserPromptSubmit', prompt_id: sha256(prompt).slice(0, 8), prompt });
  for (const input of [wake(text('message-wake.txt')), json('card-input.json'), wake(text('tap-wake.txt'))]) {
    const r = runHook(HOOK, { env, input });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  }
  const { rows, bad } = readFile(join(dir, 'journal', 'sessions', `${session}.jsonl`));
  assert.deepEqual(bad, []);
  const person = rows.filter((r) => ['person.message', 'person.tap', 'card.posted'].includes(r.kind));
  assert.deepEqual(person.map((r) => r.kind), ['person.message', 'card.posted', 'person.tap']);
  const card = person[1];
  const tap = person[2];
  assert.equal(card.payload.thread, THREAD, 'the card took its thread from the wake before it');
  assert.equal(card.payload.cardId, tap.payload.cardId);
  const view = attention(rows);
  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0].waitMs, Date.parse(tap.payload.sentAt) - Date.parse(card.at));
  assert.deepEqual([view.threads[THREAD].messages, view.threads[THREAD].taps, view.threads[THREAD].cards], [1, 1, 1]);
});
