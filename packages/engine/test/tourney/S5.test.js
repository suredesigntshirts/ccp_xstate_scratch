// S5 (trial fixes, 2026-11-04): what the real-model trial of lane S found (trial/report.md, problems 1-8 and 10), each
// fixed at its root and shown through the real code. Problem 9 (a return tool wired to another journal root) was the
// trial's setup, not the contract, and is not fixed here.
// (1) The build prompt says how a PR is opened (the GitHub tools) and what its url looks like; the run line names
//     the GitHub repository when the clone's origin is on GitHub.
// (2) Build can say "could not": blocked { reason }, exactly one of it and pr. A blocked result becomes the stage's
//     error, so quick-fix's building onError takes it to replanning, as it takes a stop without a return.
// (3) A PR ref's url must be a GitHub PR url: a prose url fails the schema, not the web-quote check.
// (4) Build has no notes field: nothing read it.
// (5) The worktree rule claims only what confine() enforces.
// (6) The brief and verify rules agree: a check stricter than its expect line goes under Advisory, never into PASS/FAIL.
// (7) Covered lines must come in the expect lines' order.
// (8) The run line is told once, as the run's context, and the stage record keeps it beside the prompt.
// (10) The data rule says the Rules and Task parts instruct (P3 holds its wording).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflow } from '../../src/index.js';
import { bind, confine, githubOf, loadRun, runDir, spawn } from '../../src/actors.js';
import { check } from '../../src/schema.js';
import { BLOCKED, WORKTREE_RULE, runLine, uncovered } from '../../src/stages.js';
import { makeWorld, ISSUE, BRIEFS, builds, prUrl } from './world.js';
import { WORKFLOWS, part, stageOf } from './contract.js';

const QF = WORKFLOWS['quick-fix'];
const build = stageOf('quick-fix', 'build');
const verify = stageOf('quick-fix', 'verify');
const readRun = (w, run, f) => readFileSync(join(runDir(w.root, run), f), 'utf8');

// A workflow copy loaded by name from a temp folder, beside copies of the other repo workflows.
function changed(name, change) {
  const dir = mkdtempSync(join(tmpdir(), 's5-'));
  for (const [n, wf] of Object.entries(WORKFLOWS)) writeFileSync(join(dir, `${n}.json`), JSON.stringify(wf));
  const spec = structuredClone(WORKFLOWS[name]);
  change(spec);
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(spec));
  return () => loadWorkflow(name, { dir });
}

// A world whose clone's origin is the GitHub repository o/r, as a real clone's would be.
async function githubWorld() {
  const w = await makeWorld();
  execFileSync('git', ['-C', w.repo, 'remote', 'add', 'origin', 'https://github.com/o/r.git']);
  return w;
}

test('S5 (1): the build prompt names the GitHub tools, the PR url shape and the repository in the run line', async () => {
  assert.ok(build.rules.some((r) => r.includes('the gh CLI or the GitHub MCP tools') && r.includes('https://github.com/<owner>/<repo>/pull/<number>')));
  assert.ok(build.rules.some((r) => r.includes('on the repository your run line names')));
  assert.match(build.properties.pr.description, /^Your PR as \{ url, at \}: url is its page, https:\/\/github\.com\/<owner>\/<repo>\/pull\/<number>,/);
  for (const [url, want] of [['https://github.com/o/r.git', 'o/r'], ['git@github.com:o/r.git', 'o/r'], ['https://github.com/o/r', 'o/r'], ['/srv/origin.git', null]]) {
    const repo = mkdtempSync(join(tmpdir(), 's5-repo-'));
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', url]);
    assert.equal(githubOf(repo), want, url);
  }
  const w = await githubWorld();
  try {
    await w.start('g', 'quick-fix', { issue: ISSUE });
    await w.agent('g', 'brief', () => BRIEFS); await w.drive('g');
    const run = loadRun(w.root, w.openRun('g', 'build').id);
    assert.equal(run.github, 'o/r');
    assert.equal(readRun(w, run.run, 'context.md'), `Run ${run.run}, worktree ${run.worktree} of https://github.com/o/r, branch ${run.branch}.`);
    const rules = part(readRun(w, run.run, 'brief.md'), 'Rules');
    assert.ok(rules.includes('Open the PR with the GitHub tools you have: the gh CLI or the GitHub MCP tools.'));
  } finally {
    await w.close();
  }
});

test('S5 (2): build returns exactly one of pr and blocked; a blocked build goes where a stage error goes, replanning', async () => {
  // The schema: exactly one alternative.
  const defs = QF.meta.schemas;
  const pr = { url: prUrl(1), at: 'a'.repeat(40) };
  assert.deepEqual(check(build, { pr }, defs), []);
  assert.deepEqual(check(build, { blocked: { reason: 'gh: 403' } }, defs), []);
  assert.deepEqual(check(build, { pr, blocked: { reason: 'x' } }, defs), ['$ must have exactly one of: pr; or blocked, not several']);
  assert.deepEqual(check(build, {}, defs), ['$ must have exactly one of: pr; or blocked']);
  assert.deepEqual(check(build, { blocked: {} }, defs), ['$.blocked.reason is missing']);
  // The route is the stage error's: building has one onError, to replanning, and no onDone reads blocked.
  assert.deepEqual(QF.states.building.invoke.onError, { target: 'replanning', actions: [{ type: 'set', params: { failure: 'event.error' } }] });
  assert.ok(!JSON.stringify(QF.states).includes(BLOCKED), 'the chart never reads blocked');
  // Only quick-fix's build declares it: research's stages answer in text, feature has no build stage of its own.
  const declaring = Object.entries(WORKFLOWS).flatMap(([n, wf]) => Object.entries(wf.meta.actors).filter(([, a]) => a?.properties?.[BLOCKED]).map(([a]) => `${n}.${a}`));
  assert.deepEqual(declaring, ['quick-fix.build']);

  const w = await githubWorld();
  try {
    await w.start('b', 'quick-fix', { issue: ISSUE });
    await w.agent('b', 'brief', () => BRIEFS); await w.drive('b');
    const runId = w.openRun('b', 'build').id;
    const both = await w.agent('b', 'build', () => ({ pr, blocked: { reason: 'x' } }), 'ag-both');
    assert.equal(both.refused?.rule, 'schema');
    const got = await w.agent('b', 'build', () => ({ blocked: { reason: 'gh pr create: HTTP 403' } }), 'ag-both');
    assert.ok(got.accepted, JSON.stringify(got));
    await w.drive('b');
    const host = w.host('b');
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(host.snapshot.context.failure, 'build blocked: gh pr create: HTTP 403');
    assert.equal(host.snapshot.context.pr, null);
    const rec = JSON.parse(readRun(w, runId, 'stage.json'));
    assert.equal(rec.finished.event, 'xstate.error.actor.build');
    assert.equal(rec.error, 'build blocked: gh pr create: HTTP 403');
    assert.deepEqual(rec.wrote.map((x) => [x.path, x.from]), [['failure', 'event.error']]);
  } finally {
    await w.close();
  }
});

test('S5 (2): a blocked output that is not an alternative, or whose invoke has no onError, is refused at load', () => {
  assert.throws(changed('quick-fix', (s) => { delete s.meta.actors.build.oneOf; s.meta.actors.build.required = ['pr']; }), /stage build output blocked is not an alternative/);
  assert.throws(changed('quick-fix', (s) => { s.meta.actors.build.properties.blocked = { type: 'string', description: 'x' }; }), /stage build output blocked is not \{ reason \}/);
  assert.throws(changed('quick-fix', (s) => { delete s.states.building.invoke.onError; }), /stage build output blocked becomes the stage's error, but invoke build \(at \/states\/building\/invoke\) has no onError/);
});

test('S5 (3): a PR ref must be a GitHub PR url; a prose url fails the schema, never the web-quote check', async () => {
  assert.equal(build.properties.pr.$ref, '#prRef');
  assert.equal(verify.properties.pr.$ref, '#prRef');
  assert.ok(!('ref' in QF.meta.schemas), 'quick-fix holds no ref that is not a PR');
  const prose = '(not opened: origin is a local bare repo; gh returns 403)';
  assert.deepEqual(check(build, { pr: { url: prose, at: 'a'.repeat(40) } }, QF.meta.schemas), [`$.pr.url does not match ${QF.meta.schemas.prRef.properties.url.pattern}`]);
  assert.equal(check(build, { pr: { url: prUrl(1), at: 'main' } }, QF.meta.schemas).length, 1, 'at is a full sha');
  const w = await makeWorld();
  try {
    await w.start('p', 'quick-fix', { issue: ISSUE });
    await w.agent('p', 'brief', () => BRIEFS); await w.drive('p');
    const got = await w.agent('p', 'build', async (a) => ({ pr: { url: prose, at: (await builds(w, 1)(a)).pr.at } }));
    assert.equal(got.refused?.rule, 'schema');
    assert.match(got.refused.reason, /^build result: result\.pr\.url does not match \^https:\/\/github/);
    assert.doesNotMatch(got.refused.reason, /quoted text/);
  } finally {
    await w.close();
  }
});

test('S5 (4): build has no notes field, and no rule or meaning speaks of notes', () => {
  assert.deepEqual(Object.keys(build.properties).sort(), ['blocked', 'pr']);
  for (const actor of ['brief', 'build', 'verify']) assert.doesNotMatch(JSON.stringify(stageOf('quick-fix', actor)), /notes/);
});

test('S5 (5): the worktree rule claims only what confine() enforces', () => {
  const worktree = mkdtempSync(join(tmpdir(), 's5-wt-'));
  mkdirSync(join(worktree, 'a'));
  // Enforced: a shell command starts in the worktree; file and search tools outside it are refused.
  assert.ok(confine({ worktree, tool: 'Bash', input: { command: 'ls' } }).input.command.startsWith(`( cd '${worktree}' || exit 1\n`));
  for (const [tool, input] of [['Read', { file_path: '/etc/hosts' }], ['Write', { file_path: '/tmp/x' }], ['Edit', { file_path: '/tmp/x' }], ['Glob', { path: '/etc' }], ['Grep', { path: '/etc' }]]) {
    assert.match(confine({ worktree, tool, input }).deny, /^own-folder:/, tool);
  }
  // Not enforced: a shell command can still read outside. The rule must not say otherwise.
  assert.ok(!confine({ worktree, tool: 'Bash', input: { command: 'cat /etc/hosts' } }).deny);
  assert.equal(WORKTREE_RULE, 'Work only in your worktree. The harness starts your shell commands in it and refuses file and search tools outside it.');
  assert.doesNotMatch(WORKTREE_RULE, /refuses file tools outside it and runs/);
});

test('S5 (6): the brief rule keeps stricter checks under Advisory, and the verify rule reads them the same way', () => {
  for (const wf of ['quick-fix', 'research']) {
    const brief = stageOf(wf, 'brief').rules.find((r) => r.startsWith('The verifier brief has exactly one check per expect line'));
    assert.match(brief, /A check's PASS and FAIL conditions test only what its expect line's words require/);
    assert.match(brief, /put anything stricter .* under a heading Advisory, never into a PASS or FAIL condition\.$/);
    assert.doesNotMatch(brief, /adds no other pass or fail condition/);
    const grade = stageOf(wf, 'verify').rules.find((r) => r.startsWith('Grade only issue.expect'));
    assert.equal(grade, "Grade only issue.expect, by what each line's words require. A condition in the brief stricter than its line, or anything under Advisory, is advisory: report it in evidence, never as a FAIL.");
  }
});

test('S5 (7): covered lines must come in the expect lines\' order', async () => {
  const issue = { url: ISSUE.url, expect: ['a', 'b', 'c'] };
  const lines = (order) => order.map((line) => ({ line, result: 'PASS', evidence: 'ran it' }));
  assert.equal(uncovered(verify, { issue }, { result: 'PASS', lines: lines(['a', 'b', 'c']) }), null);
  assert.equal(uncovered(verify, { issue }, { result: 'PASS', lines: lines(['c', 'b', 'a']) }), 'result.lines order: [0] is "c", not "a"');
  assert.equal(uncovered(verify, { issue }, { result: 'PASS', lines: lines(['a', 'c', 'b']) }), 'result.lines order: [1] is "c", not "b"');
  for (const wf of ['quick-fix', 'research']) assert.match(stageOf(wf, 'verify').properties.lines.description, /^One entry per expect line, in order: .* puts them out of order,/);
  const w = await makeWorld();
  try {
    await w.start('o', 'quick-fix', { issue });
    await w.agent('o', 'brief', () => BRIEFS); await w.drive('o');
    await w.agent('o', 'build', builds(w, 1)); await w.drive('o');
    const got = await w.agent('o', 'verify', ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result: 'PASS', pr: { url: input.target.url, at: input.target.at }, issue: input.issue, lines: lines(['b', 'a', 'c']) };
    });
    assert.deepEqual(got.refused, { rule: 'covers', reason: 'result.lines order: [0] is "b", not "a"' });
  } finally {
    await w.close();
  }
});

test('S5 (8): the run line is told once, as the run\'s context; the stage record keeps it beside the prompt', async () => {
  const w = await githubWorld();
  try {
    await w.start('c', 'quick-fix', { issue: ISSUE });
    const runId = w.openRun('c', 'brief').id;
    const run = loadRun(w.root, runId);
    const brief = readRun(w, runId, 'brief.md');
    const context = readRun(w, runId, 'context.md');
    assert.equal(context, runLine(run));
    assert.ok(!brief.includes(context), 'the prompt does not repeat the run line');
    assert.ok(!brief.includes(run.worktree), 'the worktree is named once, in the context');
    assert.equal(part(brief, 'Return').split('\n').length, 1, 'Return is the return line alone');
    // The hooks hand the agent the brief (PreToolUse of Agent) and the context (SubagentStart): each once.
    assert.equal(spawn({ root: w.root, prompt: `ccp-run ${runId}`, toolUseId: 'toolu_c' }).prompt, brief);
    assert.equal(bind({ root: w.root, agentId: 'ag-c', toolUseId: 'toolu_c' }).context, context);
    const rec = JSON.parse(readRun(w, runId, 'stage.json'));
    assert.deepEqual(rec.context, { text: context, source: { frame: 'runLine', filled: { run: runId, worktree: run.worktree, repo: run.repo, github: 'o/r', branch: run.branch } } });
    assert.ok(!Object.values(rec.prompt.parts).flat().some((p) => p.source.frame === 'runLine'), 'no prompt part is the run line');
  } finally {
    await w.close();
  }
});
