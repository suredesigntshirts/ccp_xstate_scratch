// Verifier tests for plan item engine-actors, written by the verifier session (not the builder). Offline: a local
// HTTP server stands in for GitHub's REST API, the real effects/github.js client talks to it. The world evidence
// (real headless claude runs) is read from verify/engine-actors/evidence/ by the second half of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow, restore, offer } from '../../packages/engine/src/index.js';
import { handlers, github } from '../../packages/engine/src/effects/index.js';
import { actors, accept, bind, deliver, loadRun, resultsOf, spawn } from '../../packages/engine/src/actors.js';
import { readFile } from '../../packages/journal/src/index.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const spec = loadWorkflow('quick-fix');
const HEAD = 'a'.repeat(40);
const OTHER = 'c'.repeat(40);
const PR = 'https://github.com/o/r/pull/1';
const BRIEFS = { builder: 'verifier-test builder brief', verifier: 'verifier-test verifier brief' };
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['x'] };

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'va-repo-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'f.txt'), 'x\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one']);
  return dir;
}
async function fakeGitHub() {
  const server = createServer((req, res) => {
    const ok = req.url === '/repos/o/r/pulls/1';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { number: 1, head: { sha: HEAD, ref: 'build/x' } } : { message: 'Not Found' }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { client: github({ api: `http://127.0.0.1:${server.address().port}`, env: {} }), close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}
const rowsOf = (root) => readFile(join(root, 'items', 'v-1.jsonl')).rows;
const start = (root, run, agent) => { spawn({ root, prompt: `ccp-run ${run}`, toolUseId: `t_${agent}` }); bind({ root, agentId: agent, toolUseId: `t_${agent}` }); };

// An item with the brief actor accepted and a builder agent (bd) bound to the build run.
async function building() {
  const root = mkdtempSync(join(tmpdir(), 'va-'));
  const host = restore({ root, item: 'v-1', spec, session: 's', release: '0.2.0' });
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 's' } }],
    handlers({ actors: actors({ host, repo: repo(), worktrees: join(root, 'wt') }) }));
  start(root, 'v-1:0.brief', 'br');
  assert.ok((await accept({ root, caller: 'br', run: 'v-1:0.brief', result: BRIEFS, toolUseId: 'tb' })).accepted);
  await deliver({ root, run: 'v-1:0.brief' });
  start(root, 'v-1:1.build', 'bd');
  return root;
}
const claim = (headSha, url = PR, branch = 'build/x') => ({ pr: { branch, headSha, url } });
const stateOf = (root) => restore({ root, item: 'v-1', spec, session: 's', release: '0.2.0' }).snapshot.value;

test('wrong-caller: any other agent, the main session, or a run with no agent is refused and journalled; the rule comes before schema', async () => {
  const root = await building();
  const ok = claim(HEAD);
  const other = await accept({ root, caller: 'impostor', run: 'v-1:1.build', result: ok, toolUseId: 'x1' });
  assert.deepEqual(other.refused, { rule: 'wrong-caller', reason: "agent impostor is not run v-1:1.build's actor (bd)" });
  assert.equal((await accept({ root, caller: null, run: 'v-1:1.build', result: ok })).refused.rule, 'wrong-caller', 'main session');
  assert.equal((await accept({ root, caller: 'impostor', run: 'v-1:1.build', result: {} })).refused.rule, 'wrong-caller', 'an invalid result from a wrong caller is still wrong-caller');
  assert.equal((await accept({ root, caller: 'bd', run: 'v-1:2.verify', result: {} })).refused.rule, 'unknown-run', 'a run not prepared yet');
  const refusals = rowsOf(root).filter((r) => r.kind === 'refusal' && r.payload.rule === 'wrong-caller');
  assert.equal(refusals.length, 3);
  assert.equal(refusals[0].agent, 'impostor');
  assert.equal(refusals[0].payload.run, 'v-1:1.build');
  assert.ok(!existsSync(join(root, 'items', 'v-1', 'runs', '1.build', 'result.json')), 'nothing stored');
  assert.equal(stateOf(root), 'building');
});

test('schema: a build result missing pr.url, or with a bad sha, or with no pr, is refused naming the field', async () => {
  const root = await building();
  const a = await accept({ root, caller: 'bd', run: 'v-1:1.build', result: { pr: { branch: 'b', headSha: HEAD } } });
  assert.equal(a.refused.rule, 'schema');
  assert.match(a.refused.reason, /result\.pr\.url is missing/);
  const b = await accept({ root, caller: 'bd', run: 'v-1:1.build', result: claim('abc') });
  assert.equal(b.refused.rule, 'schema');
  assert.match(b.refused.reason, /headSha/);
  const c = await accept({ root, caller: 'bd', run: 'v-1:1.build', result: {} });
  assert.match(c.refused.reason, /result\.pr is missing/);
  assert.equal(stateOf(root), 'building');
});

test('github-fact: made-up PR, real PR at the wrong head, wrong branch: refused naming the fact; item stays in building; right head accepted', async () => {
  const root = await building();
  const gh = await fakeGitHub();
  try {
    const made = await accept({ root, caller: 'bd', run: 'v-1:1.build', result: claim(HEAD, 'https://github.com/o/r/pull/9999'), github: gh.client });
    assert.equal(made.refused.rule, 'github-fact');
    assert.match(made.refused.reason, /pull\/9999: GitHub shows no such PR/);
    const moved = await accept({ root, caller: 'bd', run: 'v-1:1.build', result: claim(OTHER), github: gh.client });
    assert.equal(moved.refused.reason, `result.pr: GitHub shows ${PR} at head ${HEAD}, not the claimed ${OTHER}`);
    const br = await accept({ root, caller: 'bd', run: 'v-1:1.build', result: claim(HEAD, PR, 'nope'), github: gh.client });
    assert.match(br.refused.reason, /on branch build\/x, not the claimed nope/);
    assert.equal(stateOf(root), 'building');
    assert.deepEqual(resultsOf(restore({ root, item: 'v-1', spec, session: 's', release: '0.2.0' })), []);
    assert.equal(rowsOf(root).filter((r) => r.kind === 'refusal' && r.payload.rule === 'github-fact').length, 3);
    assert.ok((await accept({ root, caller: 'bd', run: 'v-1:1.build', result: claim(HEAD), github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: 'v-1:1.build', github: gh.client })).state, 'verifying');
  } finally {
    await gh.close();
  }
});

test('a build result whose url is not shaped /pull/N is refused as github-fact, and the item stays in building', async () => {
  const root = await building();
  const gh = await fakeGitHub();
  try {
    for (const url of ['https://example.com/not-a-pr', 'https://github.com/o/r/issues/5']) {
      const got = await accept({ root, caller: 'bd', run: 'v-1:1.build', result: claim(HEAD, url, 'anything'), github: gh.client });
      assert.equal(got.refused?.rule, 'github-fact', JSON.stringify(got));
      assert.match(got.refused.reason, /is not a GitHub PR URL/);
    }
    assert.equal(stateOf(root), 'building');
  } finally {
    await gh.close();
  }
});

// ---- the world evidence: real headless runs (verify/engine-actors/evidence/README.txt)
const ev = new URL('./evidence/', import.meta.url).pathname;
const jl = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const item = jl(join(ev, 'item-va2.jsonl'));
const sessions = readdirSync(ev).filter((f) => /^session-.*\.jsonl$/.test(f)).flatMap((f) => jl(join(ev, f)));
const promptOf = (agent) => readFileSync(join(ev, 'prompts', `${agent}.txt`), 'utf8');
const spawns = item.filter((r) => r.kind === 'agent.spawn');

test('world fixed-before-build: each agent\'s received prompt hashes to the briefHash journalled for its run; the verifier\'s was stored before the builder spawned', () => {
  for (const s of spawns) assert.equal(sha256(promptOf(s.payload.agentId)), s.payload.briefHash, `${s.payload.actor} ${s.payload.agentId}`);
  const verifier = spawns.find((s) => s.payload.actor === 'verify');
  const builder = spawns.find((s) => s.payload.actor === 'build');
  const fixed = item.findIndex((r) => r.kind === 'brief.stored' && r.payload.role === 'verifier');
  assert.ok(fixed >= 0 && fixed < item.indexOf(builder), 'brief.stored(role verifier) precedes the builder\'s agent.spawn');
  assert.ok(item[fixed].at <= builder.at);
  assert.equal(item[fixed].payload.hash, verifier.payload.briefHash);
  assert.equal(sha256(promptOf(verifier.payload.agentId)), item[fixed].payload.hash);
  // The builder's brief was fixed in the same brief result, before it spawned.
  const fixedB = item.find((r) => r.kind === 'brief.stored' && r.payload.role === 'builder');
  assert.equal(fixedB.payload.hash, builder.payload.briefHash);
});

test('world wrong-caller: the impostor\'s returns were refused and journalled; only the run\'s agent has a result.stored', () => {
  const bound = spawns.find((s) => s.payload.run === 'va2:1.build').payload.agentId;
  const refused = item.filter((r) => r.kind === 'refusal' && r.payload.rule === 'wrong-caller');
  assert.ok(refused.length >= 2);
  for (const r of refused) {
    assert.equal(r.payload.run, 'va2:1.build');
    assert.notEqual(r.payload.caller, bound);
    assert.match(r.payload.reason, /is not run va2:1.build's actor/);
    assert.ok(!spawns.some((s) => s.payload.agentId === r.payload.caller), 'the impostor was never an invoked actor');
  }
  const stored = item.filter((r) => r.kind === 'result.stored' && r.payload.run === 'va2:1.build');
  assert.deepEqual(stored.map((r) => r.payload.agentId), [bound]);
});

test('world github-fact: made-up PR and wrong head refused with the fact named; item stayed in building until the right head', () => {
  const gf = item.filter((r) => r.kind === 'refusal' && r.payload.rule === 'github-fact');
  assert.equal(gf.length, 2);
  assert.match(gf[0].payload.reason, /pull\/9999: GitHub shows no such PR/);
  assert.match(gf[1].payload.reason, /at head b7a9153721bfa3e71970dd2e8236b9e52998eb55, not the claimed 2{40}/);
  const stored = item.findIndex((r) => r.kind === 'result.stored' && r.payload.run === 'va2:1.build');
  const doneBuild = item.findIndex((r) => r.kind === 'engine.transition' && r.payload.event.type === 'xstate.done.actor.build');
  const lastRefusal = item.lastIndexOf(gf[1]);
  assert.ok(lastRefusal < stored && stored < doneBuild);
  assert.equal(item.slice(item.indexOf(gf[0]), stored).filter((r) => r.kind === 'engine.transition').length, 0, 'no transition between the claims and the accepted return');
  assert.match(item[lastRefusal].state, /building/);
});

test('world own-folder: worktrees are named item--run; every path in a bound actor\'s tool.call rows is under its worktree', () => {
  const wts = readFileSync(join(ev, 'worktree-list.txt'), 'utf8');
  let checked = 0;
  for (const s of spawns) {
    const wt = s.payload.worktree;
    assert.match(wt, new RegExp(`va2--${s.payload.run.split(':')[1].replace('.', '\\.')}$`));
    assert.ok(wts.includes(wt));
    for (const r of sessions.filter((x) => x.kind === 'tool.call' && x.agent === s.payload.agentId && Array.isArray(x.payload.paths))) {
      for (const p of r.payload.paths) { assert.ok(p === wt || p.startsWith(`${wt}/`), `${r.payload.tool} ${p}`); checked++; }
    }
  }
  assert.ok(checked >= 2, `checked ${checked} paths`);
  const distinct = new Set(spawns.map((s) => s.payload.worktree));
  assert.equal(distinct.size, spawns.length, 'each actor has its own worktree');
  const outside = item.concat(sessions).find((r) => r.kind === 'refusal' && r.payload.rule === 'own-folder');
  assert.ok(outside, 'a Read outside the worktree was refused as own-folder');
});

// ---- the return tool server itself (judging engine-host's narrowed no-agent-events test): run it over stdio
import { spawnSync } from 'node:child_process';
const serverReply = (harnessDir, lines) => {
  const out = spawnSync('node', [new URL('../../plugins/harness/scripts/return-tool.mjs', import.meta.url).pathname], {
    input: lines.map((l) => JSON.stringify({ jsonrpc: '2.0', ...l })).join('\n') + '\n', encoding: 'utf8', env: { ...process.env, CCP_HARNESS_DIR: harnessDir }, timeout: 10000
  }).stdout;
  return out.trim().split('\n').map((l) => JSON.parse(l));
};

test('return tool server: lists exactly one tool taking only run and result; a call no hook stored is not accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'va-srv-'));
  const [init, list, call] = serverReply(dir, [
    { id: 1, method: 'initialize', params: {} },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'return', arguments: { run: 'x:0.build', result: { pr: 1 }, source: { system: 'github' }, event: { type: 'xstate.done.actor.build' } } } }
  ]);
  assert.equal(init.result.serverInfo.name, 'harness');
  assert.deepEqual(list.result.tools.map((t) => t.name), ['return']);
  assert.deepEqual(Object.keys(list.result.tools[0].inputSchema.properties).sort(), ['result', 'run'], 'no event or source argument');
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /^not accepted/);
});

test('return tool server: accepts only the exact result the hook stored for the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'va-srv-'));
  const result = { pr: { branch: 'b', headSha: HEAD, url: PR } };
  const runDir = join(dir, 'journal', 'items', 'x', 'runs', '0.build');
  execFileSync('mkdir', ['-p', runDir]);
  writeFileSync(join(runDir, 'result.json'), JSON.stringify({ result, hash: sha256(JSON.stringify(result)) }));
  const [same, changed] = serverReply(dir, [
    { id: 1, method: 'tools/call', params: { name: 'return', arguments: { run: 'x:0.build', result } } },
    { id: 2, method: 'tools/call', params: { name: 'return', arguments: { run: 'x:0.build', result: { pr: { ...result.pr, headSha: OTHER } } } } }
  ]);
  assert.match(same.result.content[0].text, /^accepted/);
  assert.equal(changed.result.isError, true);
});
