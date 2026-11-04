// The world the design-C (provenance) scenario tests drive the real host in. Everything inside the harness is real:
// openItem/pinWorkflow, the host (offer/restore), wake.js, actors.js (prepare, spawn, bind, accept -> attest,
// resultsOf), the merge/card/post/timer effects and the GitHub REST client. Only the outside world is a stub:
// - git: a bare `origin` repo and a clone (`repo`) that the run worktrees are added from (real git, local only);
// - GitHub: a local HTTP server whose PR heads are read live from origin's branches, with files from `git diff`, and
//   whose merge writes a real merge commit onto the base branch in origin;
// - the thread and clock: cards, posts and wakes are recorded;
// - agents: a test plays each agent, doing in its worktree what the agent would and returning through accept();
// - the web (R1): a local server for source pages.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { offer, pending, openItem, resultsOf, accept, restore } from '../../src/index.js';
import { handlers, github } from '../../src/effects/index.js';
import { actors, spawn, bind, loadRun } from '../../src/actors.js';
import { readFile } from '../../../journal/src/index.js';

export const RELEASE = '0.2.0';
export const ITEM = 'it-1';
export const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
export const BRIEFS = { builder: 'Build math.js multiply.', verifier: 'Check math.js exports multiply.' };

export const fresh = (name = 'tourney') => mkdtempSync(join(tmpdir(), `${name}-`));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
export { git };

/** A bare origin with one commit on main, a clone of it for the run worktrees, and a scratch clone for other pushers. */
export function gitWorld() {
  const base = fresh('tourney-git');
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const seed = join(base, 'seed');
  execFileSync('git', ['clone', '-q', origin, seed], { stdio: 'ignore' });
  git(seed, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(seed, 'README.md'), 'repo\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'one');
  git(seed, 'push', '-q', 'origin', 'main');
  const repo = join(base, 'repo');
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'ignore' });
  const other = join(base, 'other');
  execFileSync('git', ['clone', '-q', origin, other], { stdio: 'ignore' });
  return { base, origin, repo, other, worktrees: join(base, 'wt') };
}

/** Someone else (not a run of this item) commits a file on a branch of origin; returns the new head. */
export function pushFromOutside(g, branch, file, text) {
  git(g.other, 'fetch', '-q', 'origin');
  git(g.other, 'checkout', '-q', '-B', branch, `origin/${branch}`);
  mkdirSync(dirname(join(g.other, file)), { recursive: true });
  writeFileSync(join(g.other, file), text);
  git(g.other, 'add', '.');
  git(g.other, 'commit', '-q', '-m', `outside ${file}`);
  git(g.other, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  return git(g.other, 'rev-parse', 'HEAD');
}

/**
 * GitHub for o/r as a local server over the origin repo. PRs: { branch, base, merged, mergeSha }; a PR's head is its
 * branch's tip in origin (as on GitHub, until it merges). GET pulls/<n>, GET pulls/<n>/files, PUT pulls/<n>/merge
 * (refused at another head when a sha is sent, as REST does). `merges` keeps every merge request the host made;
 * mergeOutside(n) merges as someone else would.
 */
export async function fakeGitHub(g) {
  const prs = {};
  const merges = [];
  let next = 0;
  const tip = (branch) => git(g.origin, 'rev-parse', `refs/heads/${branch}`);
  const headOf = (p) => (p.merged ? p.mergedHead : tip(p.branch));
  const doMerge = (n) => {
    const p = prs[n];
    const head = tip(p.branch);
    const tree = git(g.origin, 'rev-parse', `${head}^{tree}`);
    const sha = git(g.origin, 'commit-tree', tree, '-p', tip(p.base), '-p', head, '-m', `Merge #${n}`);
    git(g.origin, 'update-ref', `refs/heads/${p.base}`, sha);
    Object.assign(p, { merged: true, mergeSha: sha, mergedHead: head });
    return sha;
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      const url = new URL(req.url, 'http://x');
      const m = url.pathname.match(/^\/repos\/o\/r\/pulls\/(\d+)(\/merge|\/files)?$/);
      const p = m && prs[m[1]];
      if (!p) return reply(404, { message: 'Not Found' });
      if (req.method === 'GET' && !m[2]) {
        return reply(200, { number: Number(m[1]), merged: p.merged, merge_commit_sha: p.mergeSha, head: { sha: headOf(p), ref: p.branch }, base: { ref: p.base } });
      }
      if (req.method === 'GET' && m[2] === '/files') {
        const page = Number(url.searchParams.get('page') ?? 1);
        const names = git(g.origin, 'diff', '--name-only', `${tip(p.base)}...${headOf(p)}`).split('\n').filter(Boolean);
        return reply(200, page === 1 ? names.map((filename) => ({ filename })) : []);
      }
      const { sha } = JSON.parse(body || '{}');
      merges.push({ number: Number(m[1]), sha, base: p.base });
      if (p.merged) return reply(405, { message: 'Pull Request is not mergeable' });
      if (sha && sha !== headOf(p)) return reply(409, { message: 'Head branch was modified. Review and try the merge again.' });
      return reply(200, { sha: doMerge(m[1]), merged: true, message: 'Pull Request successfully merged' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${server.address().port}`;
  return {
    prs,
    merges,
    api,
    client: github({ api, env: {} }),
    /** The open PR from branch, or a new one into base: its number. */
    open: ({ branch, base }) => {
      const found = Object.entries(prs).find(([, p]) => p.branch === branch && !p.merged);
      if (found) return Number(found[0]);
      prs[++next] = { branch, base, merged: false, mergeSha: null };
      return next;
    },
    headOf: (n) => headOf(prs[n]),
    mergeOutside: (n) => doMerge(n),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); })
  };
}

/** Source pages for R1: https://src.test/<path> served locally. fetch(url) is the host's fetch over it. */
export async function pages(map) {
  const server = createServer((req, res) => {
    const body = map[req.url];
    res.writeHead(body == null ? 404 : 200, { 'content-type': 'text/html' });
    res.end(body ?? 'not found');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  return {
    fetch: async (url) => {
      const u = new URL(url);
      const r = await fetch(`http://127.0.0.1:${port}${u.pathname}`);
      return { status: r.status, body: await r.text() };
    },
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); })
  };
}

/** The thread and the clock as the host's effects reach them: every card, post and wake asked for is kept. */
export function platform() {
  const cards = [];
  const posts = [];
  const wakes = [];
  let n = 0;
  return {
    cards, posts, wakes,
    hearth: {
      card: async ({ key, question, choices }) => { const c = { key, ref: `cmsg_card${++n}`, question, choices }; cards.push(c); return { ref: c.ref }; },
      post: async ({ key, text }) => { const p = { key, ref: `cmsg_post${++n}`, text }; posts.push(p); return { ref: p.ref }; },
      find: async (key) => cards.find((c) => c.key === key) ?? posts.find((p) => p.key === key) ?? null
    },
    clock: { wakeAt: async ({ key, due }) => { wakes.push({ key, due }); return { ref: `wake ${key}` }; } }
  };
}

/**
 * One item's world: the journal root, git, GitHub, the thread, and the host opened with openItem (pinned workflow).
 * `handlers` are the real effect handlers with the real agent run handler (actors.js prepare).
 */
export async function itemWorld({ workflow = 'quick-fix', session = 'owner', dir, startHandlers } = {}) {
  const root = fresh('tourney-root');
  const g = gitWorld();
  const gh = await fakeGitHub(g);
  const plat = platform();
  const w = { root, g, gh, plat, session, workflow, dir, fetch: null };
  w.open = (s = session) => openItem({ root, item: ITEM, workflow, session: s, release: RELEASE, ...(dir ? { dir } : {}) });
  w.handlersFor = (host) => handlers({ github: gh.client, hearth: plat.hearth, clock: plat.clock, actors: actors({ host, repo: g.repo, worktrees: g.worktrees }) });
  w.host = w.open();
  w.handlers = w.handlersFor(w.host);
  w.close = () => gh.close();
  return w;
}

export const startEvent = (input, session = 'owner') => ({ event: { type: 'xstate.init', input }, source: { system: 'claude-code', ref: session } });

/** The open run of an actor (by actor or invoke id), if any. */
export const openRun = (host, name) => pending(host).runs.find((r) => r.actor === name || r.invoke === name) ?? null;
export const openRuns = (host) => pending(host).runs;
/** The card the ask run put up. */
export const cardOf = (host, run) => host.effects.get(run.id)?.outcome?.ref ?? null;

let tu = 0;
/** Play the agent of an open run: spawn and bind it as the hooks do, so its return passes accept()'s caller checks. */
export function agentOf(w, name) {
  const run = openRun(w.host, name);
  if (!run) throw new Error(`no open ${name} run; open: ${openRuns(w.host).map((r) => r.id).join(', ')}`);
  return agentOfRun(w, run.id);
}
export function agentOfRun(w, runId) {
  const toolUseId = `tu-${++tu}`;
  const s = spawn({ root: w.root, prompt: `ccp-run ${runId}`, toolUseId });
  if (!s?.allow) throw new Error(`spawn refused: ${s?.deny}`);
  const agentId = `agent-${tu}`;
  const b = bind({ root: w.root, agentId, toolUseId });
  const run = loadRun(w.root, runId);
  return {
    run,
    context: b.context,
    agentId,
    /** The return tool's call: accept() with the real GitHub client and the host's fetch. */
    ret: (result) => accept({ root: w.root, caller: agentId, run: runId, result, toolUseId, github: w.gh.client, ...(w.fetch ? { observe: { fetch: w.fetch } } : {}) })
  };
}

/** Hand the accepted results to the item, as deliver() and every wake do. */
export const deliver = (w) => offer(w.host, resultsOf(w.host), w.handlers);
/** Offer the events a wake text carries. */
export const wake = async (w, text, now) => offer(w.host, inputsOfWakeFor(w.host, text, now), w.handlers);
import { inputsOfWake } from '../../src/index.js';
export const inputsOfWakeFor = (host, text, now = '2999-01-01T00:00:00Z') => inputsOfWake(host, text, { now });

/** The brief agent returns briefs. */
export async function briefReturns(w, briefs = BRIEFS) {
  const a = agentOf(w, 'brief');
  const got = await a.ret(briefs);
  if (!got.accepted) throw new Error(`brief refused: ${JSON.stringify(got)}`);
  return deliver(w);
}

/**
 * The builder of the open build run (or invoke `name`) commits `files` in its worktree, pushes its lane and opens or
 * updates its one PR into its base, then returns { pr: { url, headSha } }. Returns the accept() answer and the head.
 */
export async function builderReturns(w, { name = 'build', files = { 'math.js': `export const multiply = (a, b) => a * b; // ${Date.now()}${Math.random()}\n` }, claim = null, agent = null } = {}) {
  const a = agent ?? agentOf(w, name);
  const { worktree, branch, into } = a.run;
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(worktree, file)), { recursive: true });
    writeFileSync(join(worktree, file), text);
  }
  if (Object.keys(files).length) {
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', `build ${a.run.run}`);
  }
  git(worktree, 'push', '-q', '-f', 'origin', `HEAD:refs/heads/${branch}`);
  const n = w.gh.open({ branch, base: into });
  const head = git(worktree, 'rev-parse', 'HEAD');
  const result = claim ?? { pr: { url: `https://github.com/o/r/pull/${n}`, headSha: head } };
  const got = await a.ret(result);
  return { got, head, number: n, agent: a };
}

/** The verifier of the open verify run returns a verdict; `before(worktree)` runs in its worktree first. */
export async function verifierReturns(w, { name = 'verify', result = 'PASS', extra = {}, before = null } = {}) {
  const a = agentOf(w, name);
  if (before) before(a.run.worktree, a);
  const got = await a.ret({ result, report: `${result}: checked`, ...extra });
  return { got, agent: a };
}

/** A GitHub event wake, in the real envelope (fixtures/wakes/). */
export const githubWake = (kind, json, at = '2026-11-03T12:00:00Z') =>
  `<wake reason="external-event" current-time="${at}">\n  <event source="github" kind="${kind}" from="system" trust="relay">\n    ${JSON.stringify(json)}\n  </event>\n</wake>`;
export const checkSuite = (head, pr = 'o/r#1') => githubWake('check_suite.completed', { head_sha: head, pr });
export const checkRun = (head, pr = 'o/r#1', conclusion = 'failure', check = 'test') =>
  githubWake('check_run.completed', { check, check_run_id: 1, conclusion, details_url: `https://github.com/o/r/actions/runs/1/job/${head.slice(0, 6)}`, head_sha: head, pr });
export const synchronize = (head, pr = 'o/r#1') => githubWake('pull_request.synchronize', { head_sha: head, pr });
export const closed = (pr = 'o/r#1') => githubWake('pull_request.closed', { outcome: 'merged', pr });

const fixture = (name) => readFileSync(new URL(`../fixtures/wakes/${name}.txt`, import.meta.url), 'utf8');
/** A decision-chosen wake: the person tapped option `index` on card `card`. */
export const tapWake = (card, index = 0) => fixture('tap-wake')
  .replace(/decision_id=[^<]*/, `decision_id=${card}`)
  .replace(/option=[^<]*/, `option=${String.fromCharCode(65 + index)}`)
  .replace(/option_index=[^<]*/, `option_index=${index}`);
/** The person taps option `index` on the open ask's card. */
export async function tap(w, index = 0) {
  const run = openRun(w.host, 'ask');
  if (!run) throw new Error('no open ask');
  return wake(w, tapWake(cardOf(w.host, run), index));
}
/**
 * The person's written answer to the replan card (a reply, which a tap cannot carry: the replan guard needs a why).
 * It completes the open ask run as the hearth reply would.
 */
export async function writtenAnswer(w, output) {
  const run = openRun(w.host, 'ask');
  return offer(w.host, [{ event: { type: `xstate.done.actor.${run.invoke}`, output: { by: 'person', ...output } }, run: run.id, source: { system: 'hearth', ref: `reply ${run.id}` } }], w.handlers);
}
/** A task notification that a run's worker failed. */
export const taskFailed = (runId) => `<task-notification>\n<task-id>${runId}</task-id>\n<status>failed</status>\n</task-notification>`;

export const rows = (root, item = ITEM) => readFile(join(root, 'items', `${item}.jsonl`)).rows;
export const transitionsOf = (root) => rows(root).filter((r) => r.kind === 'engine.transition');
export { offer, pending, restore, resultsOf, openItem };

/** quick-fix to awaitingMerge at the build's head: brief, build, verify PASS, CI green. Returns the head. */
export async function quickFixToMerge(w, { files } = {}) {
  await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
  await briefReturns(w);
  const b = await builderReturns(w, files ? { files } : {});
  if (!b.got.accepted) throw new Error(`build refused: ${JSON.stringify(b.got)}`);
  await deliver(w);
  const v = await verifierReturns(w);
  if (!v.got.accepted) throw new Error(`verify refused: ${JSON.stringify(v.got)}`);
  await deliver(w);
  await wake(w, checkSuite(b.head));
  return b.head;
}
