// Verifier test for obs-person-attention "rows-real" and for the main merge (refusal rows + person rows together).
// fixture/rows-real.json holds what the verifier counted in the world on 2026-10-30 (read_thread of the wf-quick-fix thread
// and list_events of its session): ids, times and hashes, never the person's text. This test rebuilds one wake per
// message and per tap with placeholder text, runs them through the real hook (capture.mjs), and compares the sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..', '..', 'plugins', 'harness');
const FX = JSON.parse(readFileSync(join(HERE, 'fixture', 'rows-real.json'), 'utf8'));

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-real-'));
  const env = { ...process.env, CCP_HARNESS_DIR: join(dir, 'harness'), CCP_HARNESS_STATE: join(dir, 'state'), CLAUDE_CODE_REMOTE_SESSION_ID: '' };
  assert.match(spawnSync('node', [join(PLUGIN, 'scripts', 'install.mjs')], { env, encoding: 'utf8' }).stdout, /installed/);
  const fire = (input) => {
    const r = spawnSync('node', [join(PLUGIN, 'scripts', 'capture.mjs')], { env, input: JSON.stringify({ session_id: 'verify-real', ...input }), encoding: 'utf8' });
    assert.equal(r.status, 0);
  };
  const rows = () => {
    const d = join(env.CCP_HARNESS_DIR, 'journal', 'sessions');
    return readdirSync(d).flatMap((f) => readFileSync(join(d, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  };
  return { fire, rows };
}

const msgWake = (id, at) => `<wake reason="mention" current-time="${at}">
  <project id="chan_x" type="project">
    <thread ts="${FX.thread}">
      <message trigger="true" from="human" trust="principal" author="Sure Team" author-id="user_x" id="${id}" sent-at="${at}" surface="app" mention="true">placeholder</message>
    </thread>
  </project>
</wake>
`;
const tapWake = (card, i, at) => `<wake reason="decision-chosen" current-time="${at}">
  <project id="chan_x" type="project">
    <thread ts="${FX.thread}">
      <message trigger="true" from="human" trust="principal" author="Sure Team" author-id="user_x" id="cmsg_tapmsg" sent-at="${at}" surface="app">chose</message>
    </thread>
  </project>
  <system-note>decision_id=${card}</system-note>
  <system-note>option=A</system-note>
  <system-note>option_index=${i}</system-note>
</wake>
`;

test('fixture: 6 person messages and 1 tap counted in the world, 20 wake prompts run', () => {
  assert.equal(FX.read_thread_person_messages.length, 6);
  assert.equal(FX.read_thread_person_taps.length, 1);
  assert.equal(FX.wake_prompts_sha256.length, FX.wake_prompts_run);
});

test('rows-real: the message ids and card id read from the thread equal the ids the hook journals (sets)', () => {
  const h = harness();
  for (const [id, at] of FX.read_thread_person_messages) h.fire({ hook_event_name: 'UserPromptSubmit', prompt: msgWake(id, at) });
  for (const t of FX.read_thread_person_taps) h.fire({ hook_event_name: 'UserPromptSubmit', prompt: tapWake(t.card, t.option_index, t.at) });
  // a repeat wake and a coordinator-cited copy must not add rows
  h.fire({ hook_event_name: 'UserPromptSubmit', prompt: msgWake(FX.read_thread_person_messages[0][0], FX.read_thread_person_messages[0][1]) });
  h.fire({ hook_event_name: 'UserPromptSubmit', prompt: `<wake reason="spawn" current-time="t"><thread ts="${FX.thread}"><message from="system">x</message></thread></wake>\n<relay from="coordinator"><cited id="cmsg_c" author="user" name="Sure Team">hi</cited></relay>` });
  const rows = h.rows();
  const msgs = new Set(rows.filter((r) => r.kind === 'person.message').map((r) => r.payload.messageId));
  const taps = new Set(rows.filter((r) => r.kind === 'person.tap').map((r) => r.payload.cardId));
  assert.deepEqual([...msgs].sort(), FX.read_thread_person_messages.map((m) => m[0]).sort());
  assert.deepEqual([...taps], FX.read_thread_person_taps.map((t) => t.card));
  assert.equal(rows.filter((r) => r.kind === 'person.message').length, 7, 'the replayed wake journals again (the view dedupes by id)');
});

test('merge: a classifier refusal row and the person rows come from the same hook and session', () => {
  const h = harness();
  h.fire({ hook_event_name: 'UserPromptSubmit', prompt: msgWake(FX.read_thread_person_messages[0][0], FX.read_thread_person_messages[0][1]) });
  h.fire({ hook_event_name: 'PermissionDenied', tool_name: 'Bash', tool_input: { command: 'echo hi' }, reason: '[Code from External]', tool_use_id: 'toolu_r1' });
  h.fire({ hook_event_name: 'PostToolUse', tool_name: 'mcp__hearthbot__request_decision', tool_input: { question: 'Q?', options: [{ label: 'a', consequence: 'x' }, { label: 'b', consequence: 'y' }], recommended: 0 }, tool_response: [{ type: 'text', text: JSON.stringify({ message_id: FX.read_thread_person_taps[0].card }) }], tool_use_id: 'toolu_c1' });
  h.fire({ hook_event_name: 'UserPromptSubmit', prompt: tapWake(FX.read_thread_person_taps[0].card, 0, FX.read_thread_person_taps[0].at) });
  const kinds = h.rows().map((r) => r.kind);
  for (const k of ['person.message', 'refusal', 'card.posted', 'person.tap']) assert.ok(kinds.includes(k), `missing ${k}`);
  const ref = h.rows().find((r) => r.kind === 'refusal');
  assert.equal(ref.payload.source, 'classifier');
});
