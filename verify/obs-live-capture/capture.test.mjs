// Verifier tests for plan item obs-live-capture. Fixture: fixture/, recorded by the verifier from its own headless
// `claude -p` session (a secret-looking Bash input, a Read, one foreground subagent with one Bash call, a backgrounded
// sleep and a last Bash) with the hooks' stdin tee'd to a log. Everything is derived from the transcripts, not from
// the builder's expected rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, handedBack, read } from '../../plugins/harness/scripts/capture-rows.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixture');
const PLUGIN = join(HERE, '..', '..', 'plugins', 'harness');
const SECRET = 'sk_test_VERIFY_8f3a91c2d7';
const sha = (t) => createHash('sha256').update(t).digest('hex');
const jsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const events = (dir = FIX) => readFileSync(join(FIX, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l.replaceAll('<fixture>', dir)));
const reader = () => (p, o) => read(p.replaceAll('<fixture>', FIX), o);

// Ground truth from the transcripts alone: each tool_use, who made it, and whether the tool ever ran.
const SUB = readdirSync(join(FIX, 'session', 'subagents')).find((n) => n.endsWith('.jsonl'));
const AGENT = SUB.replace(/^agent-/, '').replace(/\.jsonl$/, '');
function truth() {
  const out = [];
  for (const [file, agent] of [['session.jsonl', null], [join('session', 'subagents', SUB), AGENT]]) {
    const entries = jsonl(join(FIX, file));
    const results = {};
    for (const e of entries) for (const c of Array.isArray(e.message?.content) ? e.message.content : []) if (c.type === 'tool_result') results[c.tool_use_id] = JSON.stringify(c.content);
    for (const e of entries) for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (c.type === 'tool_use') out.push({ id: c.id, name: c.name, input: c.input, agent, blocked: /tool_use_error>Blocked/.test(results[c.id] ?? '') });
    }
  }
  return out;
}

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

test('fixture sanity: two parent calls, a subagent with calls, a secret in a tool input', () => {
  const t = truth();
  assert.ok(t.some((c) => c.agent === null && c.name === 'Bash' && c.input.command.includes(SECRET)));
  assert.ok(t.some((c) => c.agent === AGENT));
  assert.ok(t.some((c) => c.name === 'Agent'));
});

test('complete: one tool.call per tool call that ran, none extra (a call Claude Code blocked fires no hook)', () => {
  const ran = truth().filter((c) => !c.blocked);
  const calls = replay().rows.filter((r) => r.kind === 'tool.call');
  assert.deepEqual(calls.map((r) => r.source.ref).sort(), ran.map((c) => c.id).sort());
  assert.equal(calls.length, ran.length);
  assert.equal(new Set(calls.map((r) => r.source.ref)).size, calls.length);
  assert.ok(ran.length >= 5);
});

test('attributed: subagent calls carry its agentId, the parent\'s carry none', () => {
  const who = Object.fromEntries(truth().map((c) => [c.id, c.agent]));
  const calls = replay().rows.filter((r) => r.kind === 'tool.call');
  for (const r of calls) assert.equal(r.agent, who[r.source.ref], `${r.payload.tool} ${r.source.ref}`);
  assert.ok(calls.some((r) => r.agent === AGENT));
  assert.ok(calls.some((r) => r.agent === null));
  // the subagent's own rows are all attributed to it
  for (const r of replay().rows.filter((r) => r.kind.startsWith('agent.') || r.kind.endsWith('.stored'))) assert.equal(r.agent, AGENT);
});

test('no-content: no row or blob holds the secret or any raw tool input; hash and size are of the input JSON', () => {
  const { rows, blobs } = replay();
  const all = JSON.stringify(rows) + blobs.map((b) => b.text).join('\n');
  assert.ok(!all.includes(SECRET));
  assert.ok(!all.includes('echo last'));
  for (const c of truth().filter((c) => !c.blocked)) {
    const row = rows.find((r) => r.kind === 'tool.call' && r.source.ref === c.id);
    const given = JSON.stringify(c.input);
    // hook input and transcript input may differ in extra fields; tool_input in the hook log is authoritative
    const hook = events().find((e) => e.hook_event_name === 'PostToolUse' && e.tool_use_id === c.id);
    assert.equal(row.payload.inputHash, sha(JSON.stringify(hook.tool_input)));
    assert.equal(row.payload.inputBytes, Buffer.byteLength(JSON.stringify(hook.tool_input)));
    assert.ok(given.length > 0);
  }
  // no row holds a string field from a tool input, except the agent type (blobs hold only the brief and answer)
  for (const e of events().filter((e) => e.hook_event_name === 'PostToolUse')) {
    for (const [k, v] of Object.entries(e.tool_input)) if (k !== 'subagent_type' && !(e.tool_name === 'Agent' && k === 'prompt') && typeof v === 'string' && v.length > 6) assert.ok(!JSON.stringify(rows).includes(v), `${e.tool_name}.${k}`);
  }
});

test('blobs: brief and answer are blobs whose sha256 match the rows, recomputed from the transcripts', () => {
  const { rows, blobs } = replay();
  const brief = truth().find((c) => c.name === 'Agent').input.prompt;
  const sub = jsonl(join(FIX, 'session', 'subagents', SUB));
  assert.equal(sub[0].message.content, brief, 'the subagent transcript opens with the brief');
  const handback = sub.flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : [])).find((c) => c.name === 'SubagentHandback').input.message;
  const byHash = Object.fromEntries(blobs.map((b) => [b.hash, b.text]));
  assert.equal(byHash[sha(brief)], brief);
  assert.equal(byHash[sha(handback)], handback);
  assert.equal(rows.find((r) => r.kind === 'agent.spawn').payload.briefHash, sha(brief));
  assert.equal(rows.find((r) => r.kind === 'brief.stored').payload.hash, sha(brief));
  assert.equal(rows.find((r) => r.kind === 'agent.finish').payload.resultHash, sha(handback));
  assert.equal(rows.find((r) => r.kind === 'result.stored').payload.hash, sha(handback));
});

// The real hook, once per recorded event, in an installed project.
function runHook() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-capture-'));
  execFileSync(process.execPath, [join(PLUGIN, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir } });
  const env = { PATH: process.env.PATH, CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: join(dir, 'state') };
  const pass = () => { for (const input of events(FIX)) {
    const r = spawnSync(process.execPath, [join(PLUGIN, 'scripts', 'capture.mjs')], { env, input: JSON.stringify(input), encoding: 'utf8' });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  } };
  pass();
  const sid = events()[0].session_id;
  const read1 = () => ({ rows: jsonl(join(dir, 'journal', 'sessions', `${sid}.jsonl`)), blobs: Object.fromEntries(readdirSync(join(dir, 'journal', 'blobs')).map((n) => [n, readFileSync(join(dir, 'journal', 'blobs', n), 'utf8')])) });
  return { dir, sid, pass, read1 };
}

test('the real hook: rows match the replay, blobs are named by sha256 and stored once, no secret on disk', () => {
  const { dir, pass, read1 } = runHook();
  const { rows, blobs } = read1();
  assert.ok(!JSON.stringify(rows).includes(SECRET));
  assert.ok(!Object.values(blobs).some((t) => t.includes(SECRET)));
  const calls = rows.filter((r) => r.kind === 'tool.call');
  assert.equal(calls.length, truth().filter((c) => !c.blocked).length);
  const who = Object.fromEntries(truth().map((c) => [c.id, c.agent]));
  for (const r of calls) assert.equal(r.agent, who[r.source.ref]);
  for (const [name, text] of Object.entries(blobs)) assert.equal(sha(text), name);
  assert.equal(Object.keys(blobs).length, 2, 'brief and answer, once each');
  pass(); // a second delivery of every event must not change a blob
  assert.deepEqual(read1().blobs, blobs);
  assert.ok(dir);
});

// "Adds" per the decision plan/decisions/2026-10-30-capture-cheap-measures-what-capture-adds.md: hook.run ms is
// performance.now() at the end of the hook, so it counts Node's own start. The same figure for a bare `node`
// (a .mjs that only prints Math.round(performance.now())) is the baseline, measured here on the same machine; the
// median difference is what capture adds. The 95th percentile stays an absolute bar on the raw ms.
test('cheap (fixture run): median hook.run ms minus a bare node start <= 50 ms, raw p95 <= 200 ms', () => {
  const { dir, read1 } = runHook();
  const ms = read1().rows.filter((r) => r.kind === 'hook.run').map((r) => r.payload.ms).sort((a, b) => a - b);
  assert.ok(ms.length >= 10);
  const bare = join(dir, 'bare.mjs');
  writeFileSync(bare, 'process.stdout.write(String(Math.round(performance.now())));\n');
  const base = [];
  for (let i = 0; i < Math.max(ms.length, 15); i++) {
    const r = spawnSync(process.execPath, [bare], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    base.push(Number(r.stdout));
  }
  base.sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];
  const msg = `hook median ${med(ms)} ms (n=${ms.length}), bare node median ${med(base)} ms (n=${base.length}), adds ${med(ms) - med(base)} ms; hook p95 ${ms[Math.ceil(0.95 * ms.length) - 1]} ms`;
  assert.ok(med(ms) - med(base) <= 50, msg);
  assert.ok(ms[Math.ceil(0.95 * ms.length) - 1] <= 200, msg);
  console.log(msg);
});

// SubagentStop's early exit (b95097e): the hook may stop waiting only when the transcript ends with the result of the
// agent's own SubagentHandback call. Written by the verifier after a mutation that ignored the id match survived.
test('early settle: a tail ending in another call\'s result is not a hand-back, and a late hand-back is still captured', async () => {
  const lines = readFileSync(join(FIX, 'session', 'subagents', SUB), 'utf8').trim().split('\n');
  const swapped = lines.map((l, i) => (i === lines.length - 1 ? l.replace(/"tool_use_id":"[^"]+"/, '"tool_use_id":"toolu_other"') : l));
  assert.equal(handedBack(lines.join('\n')), true);
  assert.equal(handedBack(swapped.join('\n')), false, 'the hand-back call is there but the last result is not its own');
  // Real hook, transcript cut before the hand-back call, which lands 120 ms after the hook starts (the live race).
  const dir = mkdtempSync(join(tmpdir(), 'verify-late-'));
  execFileSync(process.execPath, [join(PLUGIN, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir } });
  const sub = join(dir, 'agent.jsonl');
  writeFileSync(sub, `${lines.slice(0, 4).join('\n')}\n`);
  const ev = events(FIX).find((e) => e.hook_event_name === 'SubagentStop');
  ev.agent_transcript_path = sub;
  const env = { PATH: process.env.PATH, CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: join(dir, 'state') };
  setTimeout(() => appendFileSync(sub, `${lines.slice(4).join('\n')}\n`), 120);
  const child = spawn(process.execPath, [join(PLUGIN, 'scripts', 'capture.mjs')], { env });
  child.stdin.end(JSON.stringify(ev));
  assert.equal(await new Promise((ok) => child.on('close', ok)), 0);
  const rows = jsonl(join(dir, 'journal', 'sessions', `${ev.session_id}.jsonl`));
  const fin = rows.find((x) => x.kind === 'agent.finish');
  const answer = JSON.parse(lines[4]).message.content.find((c) => c.name === 'SubagentHandback').input.message;
  assert.equal(rows.find((x) => x.kind === 'result.stored')?.payload.hash, sha(answer));
  assert.equal(fin.payload.resultHash, sha(answer));
  assert.ok(fin.payload.tokens.output > 0);
});
