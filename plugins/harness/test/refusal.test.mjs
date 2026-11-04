// Refusal rows (plan item obs-refusal-log): recorded refusals replayed through capture's handlers and through the
// hook as Claude Code runs it. `captured` and `retry-linked` are here; `hook-denials` and `live` are the verifier's,
// from its own session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN, REPO, runHook, temp } from './helpers.mjs';
import { actionHash, capture, denialOf, read, sha256 } from '../scripts/capture-rows.mjs';
import { readFile } from '../../../packages/journal/src/index.js';

const HOOK = join(PLUGIN, 'scripts', 'capture.mjs');
const HERE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'refusals');

// The classifier refusal the platform probe recorded live at 11:34Z: the PermissionDenied hook input as Claude Code
// sent it (probes/platform/fixtures/refusals/, first line).
const PROBED = JSON.parse(readFileSync(join(REPO, 'probes', 'platform', 'fixtures', 'refusals', '2026-10-30-self-modification-live-mod-and-hook.jsonl'), 'utf8').split('\n')[0]).input;

// A session recorded 2026-10-30 with tests/fixtures/refusals/deny-hook loaded and a settings deny rule: two runs of
// the same transcript file. It holds hook denials (probe-rule once, ccp-deny-probe twice for one command), three
// permission denials and calls that ran.
const TRANSCRIPT = join(HERE, 'hook-and-permission.jsonl');

const ids = () => {
  let n = 0;
  return () => `r${++n}`;
};

test('captured: the probe\'s classifier refusal becomes one refusal row with the classifier\'s rule text', () => {
  const { rows } = capture(PROBED, { read, newId: ids() });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.kind, 'refusal');
  assert.deepEqual(row.source, { system: 'claude-code', ref: PROBED.tool_use_id });
  assert.deepEqual(row.payload, {
    source: 'classifier',
    rule: '[Self-Modification]',
    textHash: null,
    actionHash: actionHash('Bash', PROBED.tool_input),
    tool: 'Bash',
    retryOf: null,
    outcome: 'denied',
  });
  assert.ok(!JSON.stringify(row).includes('ss-probe'), 'the row holds the refused command');
});

test('retry-linked: the same action refused again links to the first refusal by retryOf', () => {
  const newId = ids();
  const first = capture(PROBED, { read, newId }).rows[0];
  const again = { ...PROBED, tool_use_id: 'toolu_retry', tool_input: { ...PROBED.tool_input, description: 'reworded' } };
  const second = capture(again, { read, newId, refused: { [first.payload.actionHash]: first.id } }).rows[0];
  assert.equal(second.payload.retryOf, first.id);
  assert.equal(second.payload.actionHash, first.payload.actionHash);
  const other = { ...PROBED, tool_use_id: 'toolu_other', tool_input: { command: 'echo something else' } };
  assert.equal(capture(other, { read, newId, refused: { [first.payload.actionHash]: first.id } }).rows[0].payload.retryOf, null);
});

test('retry-linked: a later identical call that runs carries retryOf on its tool.call row', () => {
  const first = capture(PROBED, { read, newId: ids() }).rows[0];
  const refused = { [first.payload.actionHash]: first.id };
  const ran = capture({ ...PROBED, hook_event_name: 'PostToolUse', tool_use_id: 'toolu_ran', tool_response: {} }, { read, refused }).rows[0];
  assert.equal(ran.kind, 'tool.call');
  assert.equal(ran.payload.retryOf, first.id);
  const unrelated = capture({ ...PROBED, hook_event_name: 'PostToolUse', tool_input: { command: 'ls' } }, { read, refused }).rows[0];
  assert.equal('retryOf' in unrelated.payload, false);
});

test('hook and permission denials in the transcript become refusal rows at Stop, retries linked', () => {
  const { rows } = capture({ hook_event_name: 'Stop', transcript_path: TRANSCRIPT, session_id: 's' }, { read, newId: ids() });
  const refusals = rows.filter((r) => r.kind === 'refusal');
  assert.deepEqual(refusals.map((r) => [r.payload.source, r.payload.rule, r.payload.retryOf]), [
    ['hook', 'probe-rule', null],
    ['permission', 'deny rule', null],
    ['hook', 'ccp-deny-probe', null],
    ['hook', 'ccp-deny-probe', refusals[2].id],
    ['permission', 'deny rule', refusals[1].id],
  ]);
  assert.deepEqual(refusals.map((r) => r.source.system), ['hook', 'claude-code', 'hook', 'hook', 'claude-code']);
  for (const r of refusals) {
    assert.ok(r.at && r.source.ref.startsWith('toolu_') && r.payload.textHash && r.payload.tool === 'Bash');
  }
  // The text a permission denial carries names the command, so rows keep its hash, never the text.
  assert.ok(!JSON.stringify(refusals).includes('ccp-perm-deny'));
  assert.ok(!JSON.stringify(refusals).includes('ccp-refusal-probe'));
});

test('denials are told apart by their text; classifier refusals and ordinary errors are not counted here', () => {
  assert.deepEqual(denialOf('PreToolUse:Bash hook error: ccp-deny-probe: no'), { source: 'hook', rule: 'ccp-deny-probe' });
  assert.deepEqual(denialOf('PreToolUse:Bash hook error: [node deny.mjs]: ccp-deny-probe: no'), { source: 'hook', rule: 'ccp-deny-probe' });
  assert.deepEqual(denialOf('PreToolUse:Write hook error: this is not allowed at all'), { source: 'hook', rule: 'PreToolUse hook' });
  assert.deepEqual(denialOf('Permission to use Bash with command rm -rf x has been denied.'), { source: 'permission', rule: 'deny rule' });
  assert.deepEqual(denialOf('Permission to edit /etc/x has been denied.'), { source: 'permission', rule: 'deny rule' });
  assert.deepEqual(denialOf("The user doesn't want to proceed with this tool use. The tool use was rejected."), { source: 'permission', rule: 'person declined' });
  assert.equal(denialOf('Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Exfil Scouting].'), null);
  assert.equal(denialOf('Exit code 1\nls: cannot access x'), null);
});

test('a subagent\'s hook denial is a refusal row carrying its agent id', () => {
  const dir = temp('refusal-sub');
  const path = join(dir, 'agent.jsonl');
  const lines = [
    { type: 'assistant', timestamp: '2026-10-30T18:00:00.000Z', message: { content: [{ type: 'tool_use', id: 'toolu_s1', name: 'Bash', input: { command: 'echo x' } }] } },
    { type: 'user', timestamp: '2026-10-30T18:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_s1', is_error: true, content: 'PreToolUse:Bash hook error: ccp-deny-probe: no' }] } },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const { rows } = capture({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_transcript_path: path }, { read, newId: ids() });
  const refusal = rows.find((r) => r.kind === 'refusal');
  assert.equal(refusal.agent, 'a1');
  assert.equal(refusal.at, '2026-10-30T18:00:01.000Z');
  assert.equal(refusal.payload.rule, 'ccp-deny-probe');
});

test('the hook journals the probe\'s refusal, then links its retry and the later call that ran, across hook runs', () => {
  const dir = temp('refusal-hook');
  execFileSync(process.execPath, [join(PLUGIN, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir } });
  const env = { CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: join(dir, 'state') };
  const input = { ...PROBED, transcript_path: join(dir, 'none.jsonl') };
  for (const event of [input, { ...input, tool_use_id: 'toolu_retry' }, { ...input, hook_event_name: 'PostToolUse', tool_use_id: 'toolu_ran', tool_response: {} }]) {
    const r = runHook(HOOK, { env, input: event });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  }
  const { rows, bad } = readFile(join(dir, 'journal', 'sessions', `${PROBED.session_id}.jsonl`));
  assert.deepEqual(bad, []);
  const [first, second] = rows.filter((r) => r.kind === 'refusal');
  assert.equal(first.payload.rule, '[Self-Modification]');
  assert.equal(first.payload.retryOf, null);
  assert.equal(second.payload.retryOf, first.id);
  // Each retry links to the latest refusal of the action, so the rows form a chain back to the first.
  assert.equal(rows.find((r) => r.kind === 'tool.call').payload.retryOf, second.id);
  assert.deepEqual(rows.filter((r) => r.kind === 'hook.run').map((r) => r.payload.name), ['capture PermissionDenied', 'capture PermissionDenied', 'capture PostToolUse']);
  assert.equal(sha256(JSON.stringify(PROBED.tool_input)), rows.find((r) => r.kind === 'tool.call').payload.inputHash);
});

test('the test deny hook denies only commands containing ccp-refusal-probe, naming its rule first', () => {
  const deny = join(HERE, 'deny-hook', 'hooks', 'deny.mjs');
  const denied = runHook(deny, { input: { tool_name: 'Bash', tool_input: { command: 'echo ccp-refusal-probe' } } });
  const reason = JSON.parse(denied.stdout).hookSpecificOutput;
  assert.equal(reason.permissionDecision, 'deny');
  assert.deepEqual(denialOf(`PreToolUse:Bash hook error: ${reason.permissionDecisionReason}`), { source: 'hook', rule: 'ccp-deny-probe' });
  assert.equal(runHook(deny, { input: { tool_name: 'Bash', tool_input: { command: 'echo ok' } } }).stdout, '');
});
