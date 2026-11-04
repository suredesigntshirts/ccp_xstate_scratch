// Capture (plan item obs-live-capture): a recorded session replayed through the handlers, and through the hook as
// Claude Code runs it. Expect lines complete and cheap; the rest are the verifier's, from its own session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN, runHook, snapshot, temp } from './helpers.mjs';
import { FIXTURE, events, expected, reader } from './capture-fixture.mjs';
import { EVENTS, capture, handedBack, sha256, wakeOf } from '../scripts/capture-rows.mjs';
import { readFile } from '../../../packages/journal/src/index.js';

const HOOK = join(PLUGIN, 'scripts', 'capture.mjs');

function replay() {
  let state = {};
  const rows = [];
  const blobs = [];
  for (const input of events()) {
    const r = capture(input, { read: reader(), state });
    state = r.state;
    rows.push(...r.rows);
    blobs.push(...r.blobs);
  }
  return { rows, blobs };
}

// An installed project, made by the real install script.
function project() {
  const dir = temp('capture');
  execFileSync(process.execPath, [join(PLUGIN, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir } });
  return dir;
}

// Runs the hook once per fixture event, as Claude Code would, and returns the session's rows.
function runFixture(dir) {
  const env = { CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: join(dir, 'state') };
  for (const input of events(FIXTURE)) {
    const r = runHook(HOOK, { env, input });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  }
  const { rows, bad } = readFile(join(dir, 'journal', 'sessions', `${events()[0].session_id}.jsonl`));
  assert.deepEqual(bad, []);
  return rows;
}

const strip = ({ kind, source, agent, payload, placeholder }) => ({ kind, source, agent, payload, ...(placeholder ? { placeholder } : {}) });

test('complete: the handlers make the expected rows, one tool.call per tool call and none extra', () => {
  const { rows } = replay();
  assert.deepEqual(rows, expected());
  const calls = events().filter((e) => e.hook_event_name === 'PostToolUse' || e.hook_event_name === 'PostToolUseFailure');
  assert.equal(calls.length, 5);
  assert.deepEqual(rows.filter((r) => r.kind === 'tool.call').map((r) => r.source.ref).sort(), calls.map((e) => e.tool_use_id).sort());
});

test('attributed: the subagent\'s calls carry its agentId, the parent\'s carry none', () => {
  const byRef = Object.fromEntries(replay().rows.filter((r) => r.kind === 'tool.call').map((r) => [r.source.ref, r.agent]));
  for (const e of events().filter((e) => e.hook_event_name === 'PostToolUse')) assert.equal(byRef[e.tool_use_id], e.agent_id ?? null);
  assert.ok(Object.values(byRef).includes('aa2c1a5a260bb1ed5'));
});

test('no-content: rows hold hashes and sizes, never what a tool was given', () => {
  const text = JSON.stringify(replay().rows);
  for (const e of events().filter((e) => e.tool_input)) {
    // The agent type is kept on purpose: it names a kind of agent, not what the agent was told.
    const given = Object.entries(e.tool_input).filter(([k, v]) => k !== 'subagent_type' && typeof v === 'string' && v.length > 3);
    for (const [, value] of given) {
      assert.ok(!text.includes(value), `a row holds the tool input ${JSON.stringify(value)}`);
    }
    assert.ok(text.includes(sha256(JSON.stringify(e.tool_input))));
  }
  assert.ok(!text.includes('echo hi-one'));
});

test('blobs: the brief and the answer are blobs whose hashes match the rows', () => {
  const { rows, blobs } = replay();
  const spawn = rows.find((r) => r.kind === 'agent.spawn');
  const finish = rows.find((r) => r.kind === 'agent.finish');
  const brief = blobs.find((b) => b.hash === spawn.payload.briefHash);
  const answer = blobs.find((b) => b.hash === finish.payload.resultHash);
  assert.equal(brief.text, 'Run the bash command echo sub-one and reply with its output only.');
  assert.equal(answer.text, 'sub-one');
  for (const b of [brief, answer]) assert.equal(sha256(b.text), b.hash);
  assert.equal(rows.find((r) => r.kind === 'brief.stored').payload.hash, brief.hash);
  assert.equal(rows.find((r) => r.kind === 'result.stored').payload.hash, answer.hash);
});

test('the hook journals the expected rows and stores each blob once, as files named by their hash', () => {
  const dir = project();
  const first = runFixture(dir);
  assert.deepEqual(first.filter((r) => r.kind !== 'hook.run').map(strip), expected());
  const blobDir = join(dir, 'journal', 'blobs');
  const names = readdirSync(blobDir).sort();
  assert.equal(names.length, 2);
  for (const name of names) assert.equal(sha256(readFileSync(join(blobDir, name), 'utf8')), name);
  const before = snapshot(blobDir);
  runFixture(dir);
  assert.deepEqual(snapshot(blobDir), before, 'a second run changed a stored blob');
});

// hook.run ms counts from the hook process's start, so it holds Node's own start, which grows when the suite runs
// in parallel on a busy runner. What capture adds is the median minus a bare node start measured the same way, here
// and now (plan/decisions/2026-10-30-capture-cheap-measures-what-capture-adds.md); p95 stays an absolute bar.
test('cheap: hook.run rows show at most 50 ms median over a bare node start and 200 ms p95 per tool call', () => {
  const dir = project();
  const all = runFixture(dir).filter((r) => r.kind === 'hook.run');
  const handled = events().filter((e) => EVENTS.includes(e.hook_event_name));
  assert.equal(all.length, handled.length, 'one hook.run per handled event, none for events capture ignores');
  assert.ok(all.every((r) => r.payload.timedOut === false));
  // Per tool call: SubagentStop waits for the transcript to settle, in the background, once an agent.
  const rows = all.filter((r) => r.payload.name.startsWith('capture PostToolUse'));
  assert.equal(rows.length, 5);
  const ms = rows.map((r) => r.payload.ms).sort((a, b) => a - b);
  const at = (q) => ms[Math.min(ms.length - 1, Math.ceil(q * ms.length) - 1)];
  const bare = join(dir, 'bare.mjs');
  writeFileSync(bare, 'process.stdout.write(String(Math.round(performance.now())));\n');
  const starts = Array.from({ length: 15 }, () => Number(execFileSync(process.execPath, [bare], { env: { PATH: process.env.PATH }, encoding: 'utf8' })))
    .sort((a, b) => a - b);
  const node = starts[Math.floor(starts.length / 2)];
  assert.ok(at(0.5) - node <= 50, `median ${at(0.5)} ms, of which a bare node start is ${node} ms`);
  assert.ok(at(0.95) <= 200, `p95 ${at(0.95)} ms`);
});

test('SubagentStop stops waiting once the transcript ends with the hand-back result, and only then', () => {
  const dir = join(FIXTURE, 'session', 'subagents');
  const text = readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.jsonl'))), 'utf8');
  const kept = text.trim().split('\n');
  assert.equal(handedBack(text), true);
  assert.equal(handedBack(kept.slice(0, -1).join('\n')), false, 'the hand-back call without its result is not the end');
  assert.equal(handedBack(kept.filter((l) => !l.includes('SubagentHandback')).join('\n')), false, 'another tool result is not the end');
  assert.equal(handedBack(''), false);
});

test('inert: with no install marker the hook writes nothing and prints nothing', () => {
  const dir = temp('capture-absent');
  const r = runHook(HOOK, { env: { CCP_HARNESS_DIR: dir }, input: events()[2] });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  assert.deepEqual(snapshot(dir), {});
});

test('turn.usage reads the transcript only from where the last Stop stopped', () => {
  const dir = temp('capture-usage');
  const path = join(dir, 't.jsonl');
  const line = (id, out) => `${JSON.stringify({ type: 'assistant', message: { id, model: 'm', usage: { input_tokens: 1, output_tokens: out } } })}\n`;
  writeFileSync(path, line('a', 10) + line('a', 10));
  const stop = { hook_event_name: 'Stop', transcript_path: path, session_id: 's' };
  const one = capture(stop, { read: reader(), state: {} });
  assert.deepEqual(one.rows[0].payload.tokens, { input: 1, output: 10, cacheRead: 0, cacheCreation: 0 });
  writeFileSync(path, line('b', 7) + line('c', 3).slice(0, 20), { flag: 'a' }); // c is still being written
  const two = capture(stop, { read: reader(), state: one.state });
  assert.equal(two.rows[0].payload.messages, 1);
  assert.equal(two.rows[0].payload.tokens.output, 7);
});

test('wakes are told apart without keeping their text', () => {
  assert.deepEqual(wakeOf('<system-reminder>\n<wake reason="mention" current-time="x">'), { reason: 'mention', source: 'hearth' });
  assert.deepEqual(wakeOf('<agent-message from="a1">\nreport'), { reason: 'agent-message', source: 'subagent' });
  assert.deepEqual(wakeOf('<task-notification>\n...'), { reason: 'task-notification', source: 'claude-code' });
  assert.deepEqual(wakeOf('fix the bug'), { reason: 'prompt', source: 'user' });
});

test('hooks.json runs capture on every event it handles, in the background (async) on tool calls and subagent stops', () => {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const event of EVENTS) {
    assert.ok(hooks[event].some((g) => g.hooks.some((h) => h.command.includes('scripts/capture.mjs') && h.timeout === 5 && (h.async === true) === ['PostToolUse', 'PostToolUseFailure', 'SubagentStop'].includes(event))), event);
  }
});

test('a background agent whose transcript is not written yet still gets its brief, from the Agent call', () => {
  const start = capture({ hook_event_name: 'SubagentStart', agent_id: 'bg1', agent_type: 'general-purpose', transcript_path: '/nonexistent/s.jsonl' }, { read: reader() });
  assert.equal(start.rows[0].payload.briefHash, null);
  assert.match(start.rows[0].placeholder, /brief.stored has it/);
  const call = capture({
    hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 't1',
    tool_input: { prompt: 'do the thing', subagent_type: 'general-purpose', run_in_background: true },
    tool_response: { status: 'async_launched', agentId: 'bg1' },
  }, { read: reader() });
  assert.deepEqual(call.rows.map((r) => r.kind), ['tool.call', 'brief.stored']);
  assert.equal(call.rows[1].agent, 'bg1');
  assert.equal(call.blobs[0].hash, sha256('do the thing'));
  assert.ok(!JSON.stringify(call.rows).includes('do the thing'));
});

// obs-journal-vs-world: a merge with the GitHub MCP merge tool journals a pr.merge row, from the response the tool
// gave on 2026-10-30 (scratch PR 11), so the journal check can tell it from a merge done any other way.
test('pr.merge: the MCP merge tool makes a pr.merge row from its own response', () => {
  const input = {
    hook_event_name: 'PostToolUse', session_id: 's', tool_use_id: 'toolu_01NwGZhPAEckkCo9WNvfHhms',
    tool_name: 'mcp__github__merge_pull_request',
    tool_input: { owner: 'suredesigntshirts', repo: 'ccp_xstate_scratch', pullNumber: 11, merge_method: 'squash' },
    tool_response: [{ type: 'text', text: '{"sha":"ec58ae8d47798a6184078e8d86c935b58f67bcd2","merged":true,"message":"Pull Request successfully merged"}' }],
  };
  const { rows } = capture(input, { read: reader() });
  assert.deepEqual(rows.map((r) => r.kind), ['tool.call', 'pr.merge']);
  assert.deepEqual(rows[1], {
    kind: 'pr.merge',
    source: { system: 'github', ref: 'suredesigntshirts/ccp_xstate_scratch#11' },
    agent: null,
    payload: {
      repo: 'suredesigntshirts/ccp_xstate_scratch', number: 11, sha: 'ec58ae8d47798a6184078e8d86c935b58f67bcd2',
      tool: 'mcp__github__merge_pull_request', toolUseId: 'toolu_01NwGZhPAEckkCo9WNvfHhms',
    },
  });
  const refused = { ...input, tool_response: [{ type: 'text', text: 'Pull Request is not mergeable' }] };
  assert.deepEqual(capture(refused, { read: reader() }).rows.map((r) => r.kind), ['tool.call']);
  const other = { ...input, tool_name: 'mcp__github__pull_request_read' };
  assert.deepEqual(capture(other, { read: reader() }).rows.map((r) => r.kind), ['tool.call']);
});

test('a bound actor agent\'s rows carry its run\'s item and state; other rows carry none (plan item engine-item-views)', () => {
  const dir = project();
  const agents = join(dir, 'journal', 'actors', 'agents');
  execFileSync('mkdir', ['-p', agents]);
  writeFileSync(join(agents, 'ag1.json'), JSON.stringify({ run: 'it-1:1.build', item: 'it-1', state: '"building"', worktree: dir, toolUseId: 't0', verified: true }));
  const env = { CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: join(dir, 'state') };
  const call = (agent_id, id) => ({ session_id: 'tag-sess', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'pwd' }, tool_response: { stdout: dir }, cwd: dir, ...(agent_id ? { agent_id, agent_type: 'general-purpose' } : {}) });
  for (const input of [call('ag1', 'c1'), call('other', 'c2'), call(null, 'c3')]) assert.equal(runHook(HOOK, { env, input }).status, 0);
  const rows = readFile(join(dir, 'journal', 'sessions', 'tag-sess.jsonl')).rows.filter((r) => r.kind === 'tool.call');
  assert.deepEqual(rows.map((r) => [r.source.ref, r.item, r.state]), [['c1', 'it-1', '"building"'], ['c2', null, null], ['c3', null, null]]);
});
