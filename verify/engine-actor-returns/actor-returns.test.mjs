// Verifier tests for engine-actor-returns: the real hook script plugins/harness/scripts/actors.mjs on SubagentStop
// inputs shaped like the recorded one in plugins/harness/test/fixtures/capture/events.jsonl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = join(REPO, 'plugins', 'harness', 'scripts', 'actors.mjs');
const { restore, offer } = await import(join(REPO, 'packages', 'engine', 'src', 'index.js'));
const { handlers } = await import(join(REPO, 'packages', 'engine', 'src', 'effects', 'index.js'));
const { actors } = await import(join(REPO, 'packages', 'engine', 'src', 'actors.js'));
const { workflow, ISSUE } = await import(join(REPO, 'packages', 'engine', 'test', 'flow.js'));
const RUN = 'it-1:0.brief';
const TOOL = 'mcp__plugin_ccp-harness_harness__return';

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ver-ar-'));
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
  return { root, env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir, CLAUDE_CODE_REMOTE_SESSION_ID: '' } };
}

const run = (env, input) => {
  const out = execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'sess', ...input }), env, encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : null;
};
// The shape of the recorded SubagentStop input.
const stop = (env, agent, active) => run(env, { hook_event_name: 'SubagentStop', transcript_path: '/x/session.jsonl', permission_mode: 'auto', agent_id: agent, agent_type: 'general-purpose', stop_hook_active: active, agent_transcript_path: `/x/session/subagents/agent-${agent}.jsonl`, background_tasks: [], session_crons: [] });

async function bound() {
  const p = await project();
  run(p.env, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { prompt: `ccp-run ${RUN}` } });
  run(p.env, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
  return p;
}
const rows = (root) => {
  const f = join(root, 'items', 'it-1.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const state = (root) => restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' }).snapshot.value;

test('sent-back: a bound actor with its run open is blocked once, naming the return tool and the run', async () => {
  const { env, root } = await bound();
  const out = stop(env, 'ag1', false);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /harness__return/);
  assert.ok(out.reason.includes(RUN));
  assert.equal(state(root), 'briefing', 'blocking alone does not move the item');
  assert.equal(rows(root).filter((r) => r.kind === 'engine.transition' && /error/.test(r.payload?.event?.type ?? '')).length, 0);
});

test('fails-after: stopping again fails the run, journals no-return, and the item leaves the state by the actor error', async () => {
  const { env, root } = await bound();
  const before = state(root);
  const invoke = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' }).runs.get(RUN).invoke;
  assert.equal(stop(env, 'ag1', false).decision, 'block');
  assert.equal(stop(env, 'ag1', true), null, 'stop_hook_active lets it stop');
  const all = rows(root);
  const refusal = all.find((r) => r.kind === 'refusal' && r.payload.rule === 'no-return');
  assert.ok(refusal, 'a no-return refusal row');
  const t = all.find((r) => r.kind === 'engine.transition' && r.payload.event.type === `xstate.error.actor.${invoke}`);
  assert.ok(t, 'engine.transition on xstate.error.actor.<invoke>');
  assert.notEqual(state(root), before, `item left ${before}`);
  // The failed run now refuses a late return, and a third stop does nothing.
  assert.equal(stop(env, 'ag1', true), null);
  const late = run(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: TOOL, tool_use_id: 't9', tool_input: { run: RUN, result: { builder: 'b', verifier: 'v' } } });
  assert.equal(late.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(late.hookSpecificOutput.permissionDecisionReason, /^already-failed: /);
});

const handback = (env, agent, id = 'h1') => run(env, { hook_event_name: 'PreToolUse', agent_id: agent, tool_name: 'SubagentHandback', tool_use_id: id, tool_input: { message: 'done' } });
const failedRows = (root) => rows(root).filter((r) => r.kind === 'refusal' && r.payload.rule === 'no-return');
const errorTransitions = (root) => rows(root).filter((r) => r.kind === 'engine.transition' && /^xstate\.error\.actor\./.test(r.payload.event.type));

test('sent-back (handback path): the first SubagentHandback of a bound agent with its run open is denied no-return, naming the tool and run', async () => {
  const { env, root } = await bound();
  const out = handback(env, 'ag1').hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /^no-return: /);
  assert.match(out.permissionDecisionReason, /harness__return/);
  assert.ok(out.permissionDecisionReason.includes(RUN));
  assert.equal(state(root), 'briefing');
  assert.equal(failedRows(root).length, 0);
});

test('fails-after (handback path): a second handback fails the run and the item leaves the state; a stop after it is quiet', async () => {
  const { env, root } = await bound();
  const invoke = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' }).runs.get(RUN).invoke;
  assert.ok(handback(env, 'ag1'));
  assert.equal(handback(env, 'ag1', 'h2'), null, 'the second handback goes through');
  assert.equal(failedRows(root).length, 1);
  assert.equal(errorTransitions(root)[0].payload.event.type, `xstate.error.actor.${invoke}`);
  assert.notEqual(state(root), 'briefing');
  assert.equal(stop(env, 'ag1', false), null);
  assert.equal(failedRows(root).length, 1, 'failed once');
});

test('once holds across both ways of ending: a handback deny then a plain stop fails the run', async () => {
  const { env, root } = await bound();
  assert.ok(handback(env, 'ag1'));
  assert.equal(stop(env, 'ag1', false), null, 'no second block');
  assert.equal(failedRows(root).length, 1);
  assert.equal(errorTransitions(root).length, 1);
});

test('SubagentStop whose transcript tail is the real SubagentHandback result (recorded in ar2) fails the run at once', async () => {
  const { env, root } = await bound();
  const tx = join(mkdtempSync(join(tmpdir(), 'ver-ar-tx-')), 'agent-ag1.jsonl');
  writeFileSync(tx, readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'evidence', 'ar2-handback-tail.jsonl')));
  const out = run(env, { hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'general-purpose', stop_hook_active: false, agent_transcript_path: tx, transcript_path: '/x/s.jsonl' });
  assert.equal(out, null, 'no block');
  assert.equal(failedRows(root).length, 1);
  assert.equal(errorTransitions(root).length, 1);
  assert.notEqual(state(root), 'briefing');
});

test('a handback after the return was accepted, and by an unbound agent, goes through untouched', async () => {
  const { env, root } = await bound();
  assert.equal(handback(env, 'stranger'), null);
  assert.ok(handback(env, 'ag1'), 'denied first');
  assert.equal(run(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: TOOL, tool_use_id: 't8', tool_input: { run: RUN, result: { builder: 'b', verifier: 'v' } } }), null);
  assert.equal(handback(env, 'ag1', 'h3'), null);
  assert.equal(failedRows(root).length, 0);
  assert.equal(state(root), 'building');
});

test('stops freely: an unbound agent, even with stop_hook_active', async () => {
  const { env, root } = await bound();
  assert.equal(stop(env, 'stranger', false), null);
  assert.equal(stop(env, 'stranger', true), null);
  assert.equal(rows(root).filter((r) => r.payload?.rule === 'no-return').length, 0);
});

test('stops freely: an actor whose result was accepted', async () => {
  const { env, root } = await bound();
  const res = run(env, { hook_event_name: 'PreToolUse', agent_id: 'ag1', tool_name: TOOL, tool_use_id: 't8', tool_input: { run: RUN, result: { builder: 'b', verifier: 'v' } } });
  assert.equal(res, null, 'return accepted');
  assert.equal(stop(env, 'ag1', false), null);
  assert.equal(stop(env, 'ag1', true), null);
  assert.equal(rows(root).filter((r) => r.payload?.rule === 'no-return').length, 0);
  assert.equal(state(root), 'building');
});

test('hooks.json runs actors.mjs on SubagentStop synchronously', () => {
  const h = JSON.parse(readFileSync(join(REPO, 'plugins', 'harness', 'hooks', 'hooks.json'), 'utf8')).hooks.SubagentStop.flatMap((g) => g.hooks);
  const a = h.find((x) => x.command.includes('actors.mjs'));
  assert.ok(a);
  assert.notEqual(a.async, true);
});
