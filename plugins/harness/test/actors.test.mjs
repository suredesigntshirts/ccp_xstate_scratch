// The actor hooks (plan item engine-actors), run as Claude Code runs them: the script with a hook input on stdin, in
// a project that installed the harness. The engine's checks are tested in packages/engine/test/actors.test.js; this
// tests what the hook answers Claude Code, and that the return tool server accepts only what the hook stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN, REPO, temp } from './helpers.mjs';

const HOOK = join(PLUGIN, 'scripts', 'actors.mjs');
const SERVER = join(PLUGIN, 'scripts', 'return-tool.mjs');
const { restore, offer } = await import(join(REPO, 'packages', 'engine', 'src', 'index.js'));
const { handlers } = await import(join(REPO, 'packages', 'engine', 'src', 'effects', 'index.js'));
const { actors } = await import(join(REPO, 'packages', 'engine', 'src', 'actors.js'));
const { workflow, ISSUE } = await import(join(REPO, 'packages', 'engine', 'test', 'flow.js'));

// A harness folder with the install marker, an item of quick-fix started in it, and its brief run prepared.
async function project() {
  const dir = temp('actors');
  const root = join(dir, 'journal');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(dir, 'install.json'), '{}');
  const clone = join(dir, 'clone');
  execFileSync('git', ['init', '-q', clone]);
  writeFileSync(join(clone, 'f'), 'x');
  execFileSync('git', ['-C', clone, 'add', '-A']);
  execFileSync('git', ['-C', clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one']);
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 's' } }],
    handlers({ actors: actors({ host, repo: clone, worktrees: join(dir, 'wt') }) }));
  return { dir, root, env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir, CLAUDE_CODE_REMOTE_SESSION_ID: '' } };
}

const hook = (env, input) => {
  const out = execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'sess', ...input }), env, encoding: 'utf8' }).trim();
  return out ? JSON.parse(out).hookSpecificOutput : null;
};

// One tools/call to the return tool server, after initialize.
function callServer(env, args) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [SERVER], { env });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const reply = lines.find((m) => m.id === 2);
      if (reply) {
        child.kill();
        ok(reply.result);
      }
    });
    child.on('error', fail);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'return', arguments: args } })}\n`);
  });
}

test('the hooks start, bind, confine and check an actor, and the return tool accepts only what the hook stored', async () => {
  const { dir, root, env } = await project();
  const run = 'it-1:0.brief';

  const swap = hook(env, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { prompt: `ccp-run ${run}`, description: 'brief' } });
  assert.equal(swap.permissionDecision, undefined, 'no allow: the permission flow still decides the call');
  assert.match(swap.updatedInput.prompt, /You are the brief actor/);
  assert.equal(hook(env, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't2', tool_input: { prompt: 'hello' } }), null);

  const transcript = join(dir, 'tx', 'sess.jsonl');
  mkdirSync(join(dir, 'tx', 'sess', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'tx', 'sess', 'subagents', 'agent-ag1.meta.json'), JSON.stringify({ toolUseId: 't1' }));
  const start = hook(env, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose', transcript_path: transcript });
  assert.match(start.additionalContext, /ccp-harness run it-1:0\.brief/);

  const bash = hook(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: 'Bash', tool_use_id: 't3', tool_input: { command: 'pwd' } });
  assert.match(bash.updatedInput.command, /^\( cd '.*it-1--0\.brief' \|\| exit 1\npwd\n\)$/);
  const read = hook(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: 'Read', tool_use_id: 't4', tool_input: { file_path: '/etc/hostname' } });
  assert.equal(read.permissionDecision, 'deny');
  assert.match(read.permissionDecisionReason, /^own-folder: /);
  assert.equal(hook(env, { hook_event_name: 'PreToolUse', agent_id: 'other', tool_name: 'Read', tool_use_id: 't5', tool_input: { file_path: '/etc/hostname' } }), null, 'an unbound agent is not confined');

  const result = { builder: 'b', verifier: 'v' };
  const tool = 'mcp__plugin_ccp-harness_harness__return';
  const wrong = hook(env, { hook_event_name: 'PreToolUse', agent_id: 'other', tool_name: tool, tool_use_id: 't6', tool_input: { run, result } });
  assert.match(wrong.permissionDecisionReason, /^wrong-caller: agent other is not run it-1:0\.brief's actor \(ag1\)$/);
  assert.equal((await callServer(env, { run, result })).isError, true, 'the server refuses a result no check passed');
  const bad = hook(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: tool, tool_use_id: 't7', tool_input: { run, result: { builder: 'b' } } });
  assert.equal(bad.permissionDecisionReason, 'schema: brief result: result.verifier is missing');

  assert.equal(hook(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: tool, tool_use_id: 't8', tool_input: { run, result } }), null);
  const answer = await callServer(env, { run, result });
  assert.equal(answer.isError, undefined);
  assert.match(answer.content[0].text, /^accepted: /);
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  assert.equal(host.snapshot.value, 'building', 'the hook handed the result to the item');

  const next = hook(env, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: {}, tool_response: {} });
  assert.match(next.additionalContext, /build for it-1:1\.build: Agent tool with prompt exactly "ccp-run it-1:1\.build"/);
});

test('in a project without the install marker the hook answers nothing', () => {
  const dir = temp('actors-off');
  assert.equal(hook({ PATH: process.env.PATH, CCP_HARNESS_DIR: dir }, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't', tool_input: { prompt: 'ccp-run it-1:0.brief' } }), null);
});

// Plan item engine-actor-returns: an actor that stops without returning is sent back once, then its run fails.
const stop = (env, input) => {
  const out = execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'sess', hook_event_name: 'SubagentStop', ...input }), env, encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : null;
};

test('SubagentStop: a bound actor with its run open is blocked once with the return instruction; stopping again fails the run', async () => {
  const { root, env } = await project();
  const run = 'it-1:0.brief';
  hook(env, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { prompt: `ccp-run ${run}` } });
  hook(env, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
  // Claude Code's SubagentStop input, as run 2's verify agent got it (stop_hook_active false on its first stop).
  const base = { agent_id: 'ag1', agent_type: 'general-purpose', permission_mode: 'auto', transcript_path: '/nowhere.jsonl', agent_transcript_path: '/nowhere/agent-ag1.jsonl', last_assistant_message: 'All checks pass.' };

  assert.equal(stop(env, { ...base, agent_id: 'other', stop_hook_active: false }), null, 'an agent bound to no run stops freely');
  const first = stop(env, { ...base, stop_hook_active: false });
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /Call the harness return tool now .*"run": "it-1:0\.brief"/s);
  assert.equal(restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' }).snapshot.value, 'briefing');

  assert.equal(stop(env, { ...base, stop_hook_active: true }), null, 'the second stop is let through');
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  assert.equal(host.snapshot.value, 'replanning', 'the run\'s error moved the item on');
  assert.equal(stop(env, { ...base, stop_hook_active: false }), null, 'a failed run is not sent back again');
});

test('SubagentStop: an actor whose result was accepted stops freely', async () => {
  const { env } = await project();
  const run = 'it-1:0.brief';
  hook(env, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { prompt: `ccp-run ${run}` } });
  hook(env, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
  hook(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: 'mcp__plugin_ccp-harness_harness__return', tool_use_id: 't2', tool_input: { run, result: { builder: 'b', verifier: 'v' } } });
  assert.equal(stop(env, { agent_id: 'ag1', stop_hook_active: false }), null);
});

test('SubagentHandback: refused once with the return instruction; a second handback fails the run, and the item steps back', async () => {
  const { root, env } = await project();
  const run = 'it-1:0.brief';
  hook(env, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { prompt: `ccp-run ${run}` } });
  hook(env, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
  const call = { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: 'SubagentHandback', tool_input: { message: 'done' } };
  const first = hook(env, { ...call, tool_use_id: 'h1' });
  assert.equal(first.permissionDecision, 'deny');
  assert.match(first.permissionDecisionReason, /^no-return: .*harness__return/);
  assert.equal(hook(env, { ...call, tool_use_id: 'h2' }), null, 'the second handback goes through');
  assert.equal(restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' }).snapshot.value, 'replanning');
});

test('SubagentStop after a handback the hook let through (its transcript ends in the handback result) fails the run at once', async () => {
  const { dir, root, env } = await project();
  const run = 'it-1:0.brief';
  hook(env, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { prompt: `ccp-run ${run}` } });
  hook(env, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
  // The tail Claude Code writes for an agent that handed back (verify/engine-actor-returns/evidence/ar2-agent-tail.json).
  const tx = join(dir, 'agent-ag1.jsonl');
  writeFileSync(tx, [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_h', name: 'SubagentHandback', input: { message: 'done' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_h', content: 'Report delivered to your caller.' }] } }
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(stop(env, { agent_id: 'ag1', stop_hook_active: false, agent_transcript_path: tx }), null, 'no block: it would not bring the agent back');
  assert.equal(restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' }).snapshot.value, 'replanning');
});
