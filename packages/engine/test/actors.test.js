// Invoked actors (plan item engine-actors): a run prepared with its brief, folder and worktree; an agent bound to it
// by its Agent call; a result accepted only from that agent, in the actor's schema, with its PR on GitHub at the
// claimed head. GitHub here is a local HTTP server that the real client in effects/github.js talks to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restore, offer } from '../src/index.js';
import { handlers, github } from '../src/effects/index.js';
import { actors, accept, bind, bindLate, boundRun, confine, deliver, isReturnTool, loadRun, resultsOf, runDir, spawn, startedRun, stopped, handback, waiting } from '../src/actors.js';
import { readFile } from '../../journal/src/index.js';
import { workflow, ISSUE, BRIEFS } from './flow.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const URL_ = 'https://github.com/o/r/pull/1';

// A git repo with one commit, the clone each actor's worktree is added from.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'actors-repo-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'README.md'), 'scratch\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one']);
  return dir;
}

// GitHub with one PR, o/r#1, at a head and on a branch.
async function fakeGitHub(head = HEAD, branch = 'build/x') {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/repos/o/r/pulls/1' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/repos/o/r/pulls/1' ? { number: 1, head: { sha: head, ref: branch } } : { message: 'Not Found' }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { client: github({ api: `http://127.0.0.1:${server.address().port}`, env: {} }), close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

// An item of quick-fix started by session s, its brief run prepared by the real actor handlers.
async function started() {
  const root = mkdtempSync(join(tmpdir(), 'actors-'));
  const clone = repo();
  const worktrees = join(root, 'worktrees');
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 's' } }],
    handlers({ actors: actors({ host, repo: clone, worktrees }) }));
  return { root, clone, worktrees, host };
}
const rows = (root) => readFile(join(root, 'items', 'it-1.jsonl')).rows;
const BRIEF_RUN = 'it-1:0.brief';

// Start the run's agent the way the hooks do: the Agent call's PreToolUse, then SubagentStart.
function startAgent(root, run, agentId, toolUseId = `toolu_${agentId}`) {
  const s = spawn({ root, prompt: `ccp-run ${run}`, toolUseId });
  bind({ root, agentId, toolUseId });
  return s;
}

test('a state that invokes an agent actor prepares its run: brief, folder, worktree named by item and run, brief.stored', async () => {
  const { root, worktrees } = await started();
  const run = loadRun(root, BRIEF_RUN);
  assert.equal(run.actor, 'brief');
  assert.equal(run.worktree, join(worktrees, 'it-1--0.brief'));
  assert.equal(run.branch, 'run/it-1/0.brief');
  assert.ok(existsSync(join(run.worktree, 'README.md')), 'the worktree is a checkout');
  const brief = readFileSync(join(runDir(root, BRIEF_RUN), 'brief.md'), 'utf8');
  assert.equal(run.briefHash, sha256(brief));
  assert.equal(readFileSync(join(root, 'blobs', run.briefHash), 'utf8'), brief);
  const stored = rows(root).find((r) => r.kind === 'brief.stored');
  assert.equal(stored.payload.hash, run.briefHash);
  assert.equal(stored.item, 'it-1');
  assert.equal(stored.state, '"briefing"');
  assert.deepEqual(waiting(root, 'it-1'), [{ run: BRIEF_RUN, actor: 'brief', prompt: `ccp-run ${BRIEF_RUN}` }]);
  const effect = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'brief').at(-1);
  assert.equal(effect.payload.phase, 'done');
  assert.equal(effect.payload.outcome.spawn.prompt, `ccp-run ${BRIEF_RUN}`);
});

test('the Agent call gets the brief as its prompt, once: a second start of the run, or an unknown run, is refused', async () => {
  const { root } = await started();
  const s = spawn({ root, prompt: `ccp-run ${BRIEF_RUN}`, toolUseId: 't1' });
  assert.equal(s.prompt, readFileSync(join(runDir(root, BRIEF_RUN), 'brief.md'), 'utf8'));
  assert.match(spawn({ root, prompt: `ccp-run ${BRIEF_RUN}`, toolUseId: 't2' }).deny, /^already-started: /);
  assert.match(spawn({ root, prompt: 'ccp-run it-1:9.build', toolUseId: 't3' }).deny, /^unknown-run: /);
  assert.equal(spawn({ root, prompt: 'write a poem', toolUseId: 't4' }), null);
});

test('SubagentStart binds the agent its Agent call started, journals agent.spawn with item, state and briefHash', async () => {
  const { root } = await started();
  spawn({ root, prompt: `ccp-run ${BRIEF_RUN}`, toolUseId: 't1' });
  assert.equal(bind({ root, agentId: 'other', toolUseId: 'nope' }), null);
  const b = bind({ root, agentId: 'ag1', toolUseId: 't1' });
  assert.match(b.context, /Your worktree is .*it-1--0\.brief/);
  assert.equal(bind({ root, agentId: 'ag2', toolUseId: 't1' }), null, 'a run binds one agent');
  assert.equal(boundRun(root, 'ag1').run, BRIEF_RUN);
  const row = rows(root).find((r) => r.kind === 'agent.spawn');
  assert.deepEqual([row.item, row.state, row.agent, row.payload.run, row.payload.briefHash], ['it-1', '"briefing"', 'ag1', BRIEF_RUN, loadRun(root, BRIEF_RUN).briefHash]);
});

test('SubagentStart finds the session\'s one started run; with several starting at once, the agent binds at its first call', async () => {
  const { root } = await building();
  spawn({ root, prompt: 'ccp-run it-1:1.build', toolUseId: 'x' }); // already bound to ag2 by building()
  assert.equal(startedRun({ root, session: 's1' }), null);
  const fresh = await started();
  spawn({ root: fresh.root, prompt: `ccp-run ${BRIEF_RUN}`, toolUseId: 't1', session: 's1' });
  assert.equal(startedRun({ root: fresh.root, session: 's2' }), null, 'another session\'s start is not this one\'s');
  assert.equal(startedRun({ root: fresh.root, session: 's1' }), 't1');
  bind({ root: fresh.root, agentId: 'ag1', toolUseId: 't1', via: 'start' });
  assert.equal(startedRun({ root: fresh.root, session: 's1' }), null);
  assert.match(bindLate({ root: fresh.root, agentId: 'ag1', metaToolUseId: 'zzz' }).deny, /^bind-mismatch: /);
  assert.equal(bindLate({ root: fresh.root, agentId: 'ag1', metaToolUseId: 't1' }), null);
  assert.equal(boundRun(fresh.root, 'ag1').verified, true);
});

test('an agent SubagentStart could not bind is bound from its meta.json at its first tool call, and told its run', async () => {
  const { root } = await started();
  spawn({ root, prompt: `ccp-run ${BRIEF_RUN}`, toolUseId: 't1', session: 's1' });
  assert.equal(bindLate({ root, agentId: 'plain', metaToolUseId: 'not-a-run' }), null, 'an ordinary subagent is left alone');
  const late = bindLate({ root, agentId: 'ag1', metaToolUseId: 't1' });
  assert.match(late.bound.context, /ccp-harness run it-1:0\.brief/);
  assert.equal(rows(root).find((r) => r.kind === 'agent.spawn').payload.via, 'meta');
});

test('wrong-caller: a return from any agent but the run\'s, or from the main session, is refused and journalled', async () => {
  const { root } = await started();
  assert.equal((await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: BRIEFS })).refused.rule, 'wrong-caller', 'no agent bound yet');
  startAgent(root, BRIEF_RUN, 'ag1');
  const other = await accept({ root, caller: 'ag2', run: BRIEF_RUN, result: BRIEFS, toolUseId: 'r1' });
  assert.deepEqual(other.refused, { rule: 'wrong-caller', reason: `agent ag2 is not run ${BRIEF_RUN}'s actor (ag1)` });
  assert.equal((await accept({ root, caller: null, run: BRIEF_RUN, result: BRIEFS })).refused.rule, 'wrong-caller');
  const refusals = rows(root).filter((r) => r.kind === 'refusal');
  assert.equal(refusals.length, 3);
  assert.deepEqual([refusals[1].agent, refusals[1].payload.rule, refusals[1].payload.run, refusals[1].source.ref], ['ag2', 'wrong-caller', BRIEF_RUN, 'r1']);
  assert.ok(!existsSync(join(runDir(root, BRIEF_RUN), 'result.json')));
});

test('schema: a result missing a required field is refused, naming it', async () => {
  const { root } = await started();
  startAgent(root, BRIEF_RUN, 'ag1');
  const got = await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: { builder: 'b' } });
  assert.deepEqual(got.refused, { rule: 'schema', reason: 'brief result: result.verifier is missing' });
  assert.equal(rows(root).filter((r) => r.kind === 'refusal').at(-1).payload.rule, 'schema');
});

test('an accepted brief fixes both briefs before any build, moves the item to building and prepares the build run', async () => {
  const { root } = await started();
  startAgent(root, BRIEF_RUN, 'ag1');
  const briefs = { builder: 'Build it in your worktree.', verifier: 'Verify it independently.' };
  const got = await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: briefs, toolUseId: 'r1' });
  assert.deepEqual(got, { accepted: { run: BRIEF_RUN, hash: sha256(JSON.stringify(briefs)) } });
  assert.equal((await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: briefs })).refused.rule, 'already-returned');
  const fixed = rows(root).filter((r) => r.kind === 'brief.stored' && r.payload.role === 'verifier');
  assert.equal(fixed[0].payload.hash, sha256(briefs.verifier));

  const d = await deliver({ root, run: BRIEF_RUN });
  assert.equal(d.state, 'building');
  assert.deepEqual(d.results.map((r) => r.outcome), ['applied']);
  const build = loadRun(root, 'it-1:1.build');
  assert.equal(build.briefHash, sha256(briefs.builder), 'the builder\'s prompt is its brief exactly');
  assert.equal(readFileSync(join(runDir(root, 'it-1:1.build'), 'brief.md'), 'utf8'), briefs.builder);
  const t = rows(root).find((r) => r.kind === 'engine.transition' && r.payload.event.type === 'xstate.done.actor.brief');
  assert.deepEqual(t.source, { system: 'harness', ref: 'return r1' });
  assert.equal((await deliver({ root, run: BRIEF_RUN })).results.length, 0, 'delivered once');
});

test('a host restored later still offers an accepted result it was not handed', async () => {
  const { root } = await started();
  startAgent(root, BRIEF_RUN, 'ag1');
  await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: BRIEFS, toolUseId: 'r1' });
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  assert.deepEqual(resultsOf(host).map((i) => [i.event.type, i.run, i.source.ref]), [['xstate.done.actor.brief', BRIEF_RUN, 'return r1']]);
});

// To building with a builder agent bound, against a GitHub holding o/r#1 at HEAD.
async function building() {
  const ctx = await started();
  startAgent(ctx.root, BRIEF_RUN, 'ag1');
  await accept({ root: ctx.root, caller: 'ag1', run: BRIEF_RUN, result: BRIEFS });
  await deliver({ root: ctx.root, run: BRIEF_RUN });
  startAgent(ctx.root, 'it-1:1.build', 'ag2');
  return ctx;
}
const claim = (headSha, url = URL_, branch = 'build/x') => ({ pr: { branch, headSha, url } });

test('github-fact: a claimed PR GitHub doesn\'t show, or shows at another head, is refused and the item stays in building', async () => {
  const { root } = await building();
  const gh = await fakeGitHub();
  try {
    const missing = await accept({ root, caller: 'ag2', run: 'it-1:1.build', result: claim(HEAD, 'https://github.com/o/r/pull/99'), github: gh.client });
    assert.equal(missing.refused.rule, 'github-fact');
    assert.match(missing.refused.reason, /pull\/99: GitHub shows no such PR/);
    const moved = await accept({ root, caller: 'ag2', run: 'it-1:1.build', result: claim(OTHER), github: gh.client });
    assert.equal(moved.refused.reason, `result.pr: GitHub shows ${URL_} at head ${HEAD}, not the claimed ${OTHER}`);
    const notPr = await accept({ root, caller: 'ag2', run: 'it-1:1.build', result: claim(HEAD, 'https://example.com/not-a-pr'), github: gh.client });
    assert.equal(notPr.refused.reason, 'result.pr.url "https://example.com/not-a-pr" is not a GitHub PR URL', 'no shape of url skips GitHub');
    const branch = await accept({ root, caller: 'ag2', run: 'it-1:1.build', result: claim(HEAD, URL_, 'build/y'), github: gh.client });
    assert.match(branch.refused.reason, /on branch build\/x, not the claimed build\/y/);
    const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
    assert.equal(host.snapshot.value, 'building');
    assert.deepEqual(resultsOf(host), []);

    assert.ok((await accept({ root, caller: 'ag2', run: 'it-1:1.build', result: claim(HEAD), github: gh.client })).accepted);
    assert.equal((await deliver({ root, run: 'it-1:1.build' })).state, 'verifying');
    assert.equal(loadRun(root, 'it-1:2.verify').briefHash, sha256(BRIEFS.verifier));
  } finally {
    await gh.close();
  }
});

test('own-folder: a bound agent\'s shell runs from its worktree, and file tools outside it are refused', () => {
  const wt = '/w/it-1--1.build';
  assert.deepEqual(confine({ worktree: wt, tool: 'Bash', input: { command: 'ls', description: 'd' } }), { input: { command: "( cd '/w/it-1--1.build' || exit 1\nls\n)", description: 'd' } });
  assert.equal(confine({ worktree: wt, tool: 'Bash', input: { command: "( cd '/w/it-1--1.build' || exit 1\nls\n)" } }), null);
  assert.equal(confine({ worktree: wt, tool: 'Read', input: { file_path: `${wt}/a.js` } }), null);
  assert.match(confine({ worktree: wt, tool: 'Write', input: { file_path: '/etc/passwd' } }).deny, /^own-folder: /);
  assert.match(confine({ worktree: wt, tool: 'Edit', input: { file_path: `${wt}/../it-1--2.verify/x` } }).deny, /^own-folder: /);
  assert.deepEqual(confine({ worktree: wt, tool: 'Grep', input: { pattern: 'x' } }), { input: { pattern: 'x', path: wt } });
  assert.match(confine({ worktree: wt, tool: 'Glob', input: { pattern: '*', path: '/tmp' } }).deny, /^own-folder: /);
  assert.equal(confine({ worktree: wt, tool: 'ToolSearch', input: { query: 'x' } }), null);
});

test('the return tool is known under its plugin prefix and its bare name only', () => {
  assert.ok(isReturnTool('mcp__harness__return'));
  assert.ok(isReturnTool('mcp__plugin_ccp-harness_harness__return'));
  assert.ok(!isReturnTool('mcp__evil_return'));
  assert.ok(!isReturnTool('mcp__harness__return2'));
});

// Plan item engine-actor-returns: an actor that stops without returning is sent back once, then its run fails.
test('stopped: sent back once, then the run fails with a no-return refusal and the actor\'s error moves the item', async () => {
  const { root } = await started();
  assert.equal(stopped({ root, agentId: 'ag1' }), null, 'no agent bound yet');
  startAgent(root, BRIEF_RUN, 'ag1');
  assert.match(stopped({ root, agentId: 'ag1' }).block, /Call the harness return tool now .*it-1:0\.brief/);
  assert.deepEqual(stopped({ root, agentId: 'ag1', session: 's' }), { failed: BRIEF_RUN }, 'sent back once only, even without stop_hook_active');
  assert.equal(stopped({ root, agentId: 'ag1', again: true }), null, 'failed once');
  const refusal = rows(root).filter((r) => r.kind === 'refusal').at(-1);
  assert.deepEqual([refusal.payload.rule, refusal.payload.run, refusal.source.ref], ['no-return', BRIEF_RUN, 'stop ag1']);
  assert.equal((await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: BRIEFS })).refused.rule, 'already-failed');

  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  assert.deepEqual(resultsOf(host).map((i) => [i.event.type, i.source.ref]), [['xstate.error.actor.brief', 'stop ag1']]);
  const d = await deliver({ root, run: BRIEF_RUN });
  assert.equal(d.state, 'replanning');
  const t = rows(root).find((r) => r.kind === 'engine.transition' && r.payload.event.type === 'xstate.error.actor.brief');
  assert.deepEqual(t.source, { system: 'harness', ref: 'stop ag1' });
});

test('stopped: an agent whose result was accepted stops freely', async () => {
  const { root } = await started();
  startAgent(root, BRIEF_RUN, 'ag1');
  await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: BRIEFS });
  assert.equal(stopped({ root, agentId: 'ag1' }), null);
  assert.equal(stopped({ root, agentId: 'ag1', again: true }), null);
});

test('handback: the first SubagentHandback with the run open is refused with the return instruction, the next fails the run', async () => {
  const { root } = await started();
  startAgent(root, BRIEF_RUN, 'ag1');
  assert.equal(handback({ root, agentId: 'other' }), null, 'not an actor');
  assert.match(handback({ root, agentId: 'ag1' }).deny, /^no-return: .*Call the harness return tool now/);
  assert.deepEqual(handback({ root, agentId: 'ag1' }), { failed: BRIEF_RUN });
  assert.equal(stopped({ root, agentId: 'ag1' }), null, 'its stop after that adds nothing');
  assert.equal(rows(root).filter((r) => r.kind === 'refusal' && r.payload.rule === 'no-return').at(-1).payload.tool, 'SubagentHandback');
  assert.equal((await deliver({ root, run: BRIEF_RUN })).state, 'replanning');
});

test('stopped: a stop after a handback the hook never saw fails the run at once, since a block cannot bring it back', async () => {
  const { root } = await started();
  startAgent(root, BRIEF_RUN, 'ag1');
  assert.deepEqual(stopped({ root, agentId: 'ag1', handedBack: true }), { failed: BRIEF_RUN });
});

test('handback: an agent sent back that then returns hands back freely', async () => {
  const { root } = await started();
  startAgent(root, BRIEF_RUN, 'ag1');
  assert.ok(handback({ root, agentId: 'ag1' }).deny);
  await accept({ root, caller: 'ag1', run: BRIEF_RUN, result: BRIEFS });
  assert.equal(handback({ root, agentId: 'ag1' }), null);
});
