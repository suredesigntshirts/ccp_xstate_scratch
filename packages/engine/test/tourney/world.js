// Tourney lane E: the stubbed world the scenario tests drive the real host in. Only the outside is stubbed: GitHub is
// a local HTTP server that the real REST client (src/effects/github.js) talks to, the thread and clock are the parity
// world's platform(), agents' outputs are what each test says they return, and a real git repo holds the commits
// the agents' worktrees check out. Agent results go the real way: prepare (the run handler), spawn, bind, accept,
// resultsOf (which adds the host's observed part), offer.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restore, offer, pending, inputsOfWake, loadWorkflow, observe } from '../../src/index.js';
import { handlers, github, children, childEvents } from '../../src/effects/index.js';
import { actors, spawn, bind, accept, resultsOf, loadRun, spawnPrompt, runDir } from '../../src/actors.js';
import { platform, tapWake } from '../parity/world.js';
import { readFile } from '../../../journal/src/index.js';
import { itemFile } from '../../src/host.js';

export { restore, offer, pending, loadWorkflow, observe, platform, tapWake, loadRun, childEvents };
export const RELEASE = '0.2.0';
export const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
export const BRIEFS = { builder: 'Build: make math.js export multiply.', verifier: 'Verify: math.js exports multiply and its tests pass.' };
export const prUrl = (n) => `https://github.com/o/r/pull/${n}`;

/** An issue body whose Expect lines are `expect`. */
export const issueBody = (expect) => `Make multiply.\n\n## Expect\n${expect.map((l) => `- ${l}`).join('\n')}\n\n## Notes\n- none\n`;
export const fresh = (name = 'tourney') => mkdtempSync(join(tmpdir(), `${name}-`));
export const rows = (root, item = 'it-1') => readFile(itemFile(root, item)).rows;
export const transitions = (root, item = 'it-1') => rows(root, item).filter((r) => r.kind === 'engine.transition');

/** A git repo with one commit; commit() makes a new commit object on top of HEAD and returns its sha. */
export function gitRepo() {
  const dir = fresh('tourney-repo');
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', dir]);
  git('commit', '-q', '--allow-empty', '-m', 'base');
  let n = 0;
  return { dir, git, commit: (msg = `c${++n}`) => git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', `${msg} ${n++}`) };
}

/**
 * GitHub as a local server. prs: { n: { head, branch, merged, mergeSha, state, files } }, checks: { sha: [check runs] },
 * issues: { n: { body } }. Merges are kept in `merges` (only those made through the merge endpoint, the host's).
 */
export async function fakeGitHub() {
  const prs = {};
  const checks = {};
  const issues = { 7: { body: issueBody(ISSUE.expect) } };
  const merges = [];
  const closes = [];
  let mergeN = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      let m;
      if ((m = req.url.match(/^\/repos\/o\/r\/commits\/([0-9a-f]+)\/check-runs$/))) return reply(200, { check_runs: checks[m[1]] ?? [] });
      if ((m = req.url.match(/^\/repos\/o\/r\/issues\/(\d+)$/))) return issues[m[1]] ? reply(200, issues[m[1]]) : reply(404, { message: 'Not Found' });
      m = req.url.match(/^\/repos\/o\/r\/pulls\/(\d+)(\/merge|\/files)?$/);
      const p = m && prs[m[1]];
      if (!p) return reply(404, { message: 'Not Found' });
      if (req.method === 'GET' && m[2] === '/files') return reply(200, (p.files ?? []).map((filename) => ({ filename })));
      if (req.method === 'GET') return reply(200, { number: Number(m[1]), state: p.state, merged: p.merged, merge_commit_sha: p.mergeSha, head: { sha: p.head, ref: p.branch } });
      if (req.method === 'PATCH') { const { state } = JSON.parse(body || '{}'); p.state = state; closes.push(Number(m[1])); return reply(200, { state }); }
      const { sha } = JSON.parse(body || '{}');
      merges.push({ number: Number(m[1]), sha });
      if (p.merged || p.state === 'closed') return reply(405, { message: 'Pull Request is not mergeable' });
      if (sha && sha !== p.head) return reply(409, { message: 'Head branch was modified. Review and try the merge again.' });
      p.merged = true;
      p.mergeSha = (++mergeN).toString(16).padStart(40, 'e');
      return reply(200, { sha: p.mergeSha, merged: true });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${server.address().port}`;
  return {
    prs, checks, issues, merges, closes,
    open: (n, { head, branch, files = ['math.js'] }) => { prs[n] = { head, branch, merged: false, mergeSha: null, state: 'open', files }; },
    push: (n, head) => { prs[n].head = head; },
    green: (sha, name = 'test') => { checks[sha] = [{ name, conclusion: 'success', html_url: `https://ci/${sha}` }]; },
    red: (sha, name = 'test') => { checks[sha] = [{ name, conclusion: 'failure', html_url: `https://ci/${sha}/${name}` }]; },
    client: github({ api, env: {} }),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); })
  };
}

/** A host for an item and the handlers it runs with: real agent run handler, merge, close, card, timer. */
export function hostFor({ root, item = 'it-1', spec = loadWorkflow('quick-fix'), session = 'owner', repo, gh, plat, publisher = null, fetch = null, specs = null, childHandlers = null }) {
  const host = restore({ root, item, spec, session, release: RELEASE });
  const effects = makeEffects(host, { repo, gh, plat, publisher, fetch, specs, childHandlers });
  return { host, effects };
}
export function makeEffects(host, { repo, gh, plat, publisher = null, fetch = null, specs = null, childHandlers = null }) {
  const agentRuns = actors({ host, repo: repo.dir, worktrees: join(host.root, 'worktrees'), names: ['brief', 'build', 'verify', 'plan', 'research', 'synthesize'] });
  const extra = specs ? { start: children({ parent: host, specs, handlersFor: childHandlers ?? (() => ({})) }) } : {};
  return handlers({ github: gh?.client ?? null, hearth: plat.hearth, clock: plat.clock, publisher, fetch, actors: { ...agentRuns, ...extra } });
}

export const start = (input = { issue: ISSUE }, session = 'owner') => ({ event: { type: 'xstate.init', input }, source: { system: 'claude-code', ref: session } });
export const openRun = (host, actor) => pending(host).runs.find((r) => r.actor === actor) ?? null;
export const cardOf = (host) => { const run = openRun(host, 'ask'); return run ? host.effects.get(run.id)?.outcome?.ref ?? null : null; };
let calls = 0;
const boundAgent = (root, run) => { try { return JSON.parse(readFileSync(join(runDir(root, run), 'agent.json'), 'utf8')).agentId; } catch { return null; } };

/**
 * The open run of `actor` returns `result` the real way: its agent is spawned and bound, optionally checks out
 * `checkout` in its worktree first (what the agent actually looked at), and calls the return tool (accept). The
 * accepted result is then offered to the item through resultsOf. Returns { refused } or { results }.
 */
export async function agentReturns(host, actor, result, { checkout = null, gh, effects }) {
  const run = openRun(host, actor);
  if (!run) throw new Error(`no open ${actor} run (state ${JSON.stringify(host.snapshot.value)})`);
  const toolUseId = `t${++calls}`;
  // The run's agent, once bound, is the one that returns (again, after a refusal).
  const bound = boundAgent(host.root, run.id);
  const agentId = bound ?? `agent-${calls}`;
  if (!bound) {
    spawn({ root: host.root, prompt: spawnPrompt(run.id), toolUseId, session: host.session });
    bind({ root: host.root, agentId, toolUseId });
  }
  if (checkout) execFileSync('git', ['-C', loadRun(host.root, run.id).worktree, 'checkout', '-q', '--detach', checkout]);
  const got = await accept({ root: host.root, caller: agentId, run: run.id, result, toolUseId: `r${calls}`, github: gh?.client });
  if (got.refused) return { refused: got.refused };
  return { results: await offer(host, resultsOf(host), effects) };
}

/** The branch the host gave the open build run. */
export const buildBranch = (host) => loadRun(host.root, openRun(host, 'build').id).branch;

/** A wake for the item: the host observes GitHub, then the wake's own inputs (a tap, timers). */
export async function wake(host, { gh, effects, text = null, now = '2999-01-01T00:00:00Z' }) {
  const inputs = [...(gh ? await observe(host, gh.client) : []), ...(text ? inputsOfWake(host, text, { now }) : [])];
  return offer(host, inputs, effects);
}

/** The person taps option `index` on the item's open card. */
export async function tap(host, { effects, index = 0, gh = null }) {
  const card = cardOf(host);
  if (!card) throw new Error(`no open card (state ${JSON.stringify(host.snapshot.value)})`);
  return wake(host, { gh, effects, text: tapWake(card, index) });
}

/** The person answers the replan card with a written why (the stand-in answer path; one tap). */
export async function replanWithWhy(host, why, effects) {
  const run = openRun(host, 'ask');
  return offer(host, [{ event: { type: `xstate.done.actor.${run.invoke}`, output: { choice: 'replan', by: 'person', why } }, run: run.id, source: { system: 'hearth', ref: `answer ${run.id}` } }], effects);
}

/** Take an item from start to its first build's PR, at head `head`, on PR `n`. Returns the branch. */
export async function toJudging(host, { gh, effects, head, n = 1, files }) {
  await offer(host, [start()], effects);
  await agentReturns(host, 'brief', BRIEFS, { gh, effects });
  const branch = buildBranch(host);
  gh.open(n, { head, branch, files });
  const got = await agentReturns(host, 'build', { pr: { branch, headSha: head, url: prUrl(n) } }, { gh, effects });
  if (got.refused) throw new Error(JSON.stringify(got.refused));
  return branch;
}
