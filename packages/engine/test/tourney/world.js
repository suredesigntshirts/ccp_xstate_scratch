// The world the design-A tourney scenarios run in. The engine is real: items restored from their journals, offered
// events through offer()/pump(), the real effect handlers, the real agent run handler (prepare), the real hooks'
// spawn/bind, and the real accept() check. Only the outside is stubbed: GitHub (a local REST server), web pages,
// the thread (cards, posts), wakes (built from the real fixtures) and what each agent does and returns.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { restore, offer, pending, itemFile } from '../../src/host.js';
import { inputsOfWake } from '../../src/wake.js';
import { actors, accept, bind, spawn, resultsOf, loadRun } from '../../src/actors.js';
import { handlers, github, pump, openItems, childResults } from '../../src/effects/index.js';
import { loadWorkflow, workflowOf } from '../../src/index.js';
import { readFile } from '../../../journal/src/index.js';
import { fresh, gitRepo, platform, tapWake } from '../parity/world.js';

export { offer, fresh, gitRepo, platform, tapWake, loadWorkflow, workflowOf, resultsOf, childResults, openItems, pending, itemFile };
export const RELEASE = '0.2.0';
export const SESSION = 'owner';
export const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
export const prUrl = (n) => `https://github.com/o/r/pull/${n}`;
export const MERGE = (n) => String(n).padStart(2, '0').repeat(20);

/** GitHub as a local REST server: PRs { head, base, files, merged }, check suites by sha, merges recorded. */
export async function fakeGitHub(prs = {}) {
  const state = Object.fromEntries(Object.entries(prs).map(([n, p]) => [n, { merged: false, mergeSha: null, base: 'main', files: [], ...p }]));
  const suites = {}; // sha -> [{ status, conclusion }]
  const merges = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      const path = req.url.split('?')[0];
      const cs = path.match(/^\/repos\/o\/r\/commits\/([0-9a-f]+)\/check-suites$/);
      if (cs) return reply(200, { total_count: (suites[cs[1]] ?? []).length, check_suites: suites[cs[1]] ?? [] });
      const m = path.match(/^\/repos\/o\/r\/pulls\/(\d+)(\/merge|\/files)?$/);
      const p = m && state[m[1]];
      if (!p) return reply(404, { message: 'Not Found' });
      if (req.method === 'GET' && m[2] === '/files') return p.filesError ? reply(502, { message: 'Bad Gateway' }) : reply(200, p.files.map((filename) => ({ filename })));
      if (req.method === 'GET' && !m[2]) return reply(200, { number: Number(m[1]), merged: p.merged, merge_commit_sha: p.mergeSha, head: { sha: p.head, ref: 'b' }, base: { ref: p.base } });
      const { sha } = JSON.parse(body || '{}');
      merges.push({ number: Number(m[1]), sha, base: p.base });
      if (p.merged) return reply(405, { message: 'Pull Request is not mergeable' });
      if (sha && sha !== p.head) return reply(409, { message: 'Head branch was modified. Review and try the merge again.' });
      p.merged = true;
      p.mergeSha = MERGE(m[1]);
      return reply(200, { sha: p.mergeSha, merged: true });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${server.address().port}`;
  return {
    state, suites, merges,
    open: (n, head, extra = {}) => { state[n] = { merged: false, mergeSha: null, base: 'main', files: [], ...extra, head }; },
    push: (n, head) => { state[n].head = head; },
    green: (sha) => { suites[sha] = [{ status: 'completed', conclusion: 'success' }]; },
    client: github({ api, env: {} }),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); })
  };
}

/** Web pages as the host fetches them: { url: body }. */
export const webOf = (pages = {}) => ({ pages, get: async (url) => (url in pages ? { status: 200, body: pages[url] } : { status: 404, body: '' }) });

// ---- Wakes, from the real fixtures' shapes (../fixtures/wakes/)
const ev = (kind, json, at = '2026-10-30T18:06:40Z') =>
  `<wake reason="external-event" current-time="${at}">\n  <event source="github" kind="${kind}" from="system" trust="relay">\n    ${JSON.stringify(json)}\n  </event>\n</wake>`;
export const suiteWake = (head, n = 1) => ev('check_suite.completed', { head_sha: head, pr: `o/r#${n}` });
export const redWake = (head, n = 1, check = 'test') => ev('check_run.completed', { check, check_run_id: 1, conclusion: 'failure', details_url: `https://ci/${check}/${head}`, head_sha: head, pr: `o/r#${n}` });
export const closedWake = (n = 1) => ev('pull_request.closed', { outcome: 'merged', pr: `o/r#${n}` });
export const taskWake = (id, status = 'failed') => `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>`;

/** A world: root, repo, GitHub, web, thread; handlersFor(host) and drive(top, wakeText?) over the real engine. */
export async function makeWorld({ prs = {}, pages = {}, dir = null, session = SESSION } = {}) {
  const root = fresh('tourney');
  const repo = gitRepo();
  const worktrees = join(root, 'wt');
  const gh = await fakeGitHub(prs);
  const web = webOf(pages);
  const plat = platform();
  let commits = 0;
  const load = (name, opts) => loadWorkflow(name, { ...opts, dir });
  const handlersFor = (host) => handlers({
    github: gh.client, hearth: plat.hearth,
    actors: actors({ host, repo, worktrees }),
    host, workflows: ['quick-fix', 'feature', 'research'], load, handlersFor
  });
  const w = {
    root, repo, gh, web, plat, load, handlersFor, session,
    host: (item) => { const spec = workflowOf(root, item); return spec && restore({ root, item, spec, session, release: RELEASE }); },
    /** Start a top item of a workflow with input. */
    start: async (item, name, input) => {
      const host = restore({ root, item, spec: load(name, { root }), session, release: RELEASE });
      const r = await offer(host, [{ event: { type: 'xstate.init', input }, source: { system: 'claude-code', ref: `start ${item}` } }], handlersFor(host));
      await w.drive(item);
      return r;
    },
    /** Offer a wake's inputs (per item) and everything that follows, across the item and its children. */
    drive: (top, text = '') => pump({ root, top, session, release: RELEASE, handlersFor,
      inputsFor: (host) => (text ? inputsOfWake(host, text, { now: '2999-01-01T00:00:00Z' }) : []) }),
    rows: (item) => readFile(itemFile(root, item)).rows,
    openRun: (item, actor) => pending(w.host(item)).runs.find((r) => r.actor === actor || r.invoke === actor) ?? null,
    cardOf: (item) => { const h = w.host(item); const run = pending(h).runs.find((r) => r.actor === 'ask'); return run && h.effects.get(run.id)?.outcome?.ref; },
    /** Commit in a worktree; returns the new sha. */
    commit: (worktree, msg = 'work') => {
      // Unique message: two empty commits on the same parent in the same second would otherwise share a sha.
      execFileSync('git', ['-C', worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', `${msg} #${++commits}`]);
      return execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    },
    checkout: (worktree, sha) => execFileSync('git', ['-C', worktree, 'checkout', '-q', '--detach', sha]),
    /**
     * An agent does its work and returns through the real hooks: the run of `actor` open on `item` is spawned and
     * bound, `act({ run, input, worktree })` does the agent's outside work and gives its result, and accept() checks
     * it. Returns accept's answer. The accepted result reaches the item at the next drive().
     */
    agent: async (item, actor, act, agentId = null) => {
      const run = w.openRun(item, actor);
      if (!run) throw new Error(`no open ${actor} run on ${item}`);
      const id = agentId ?? `ag-${run.id}`.replace(/[^\w-]/g, '_');
      const tool = `toolu_${id}`;
      spawn({ root, prompt: `ccp-run ${run.id}`, toolUseId: tool });
      bind({ root, agentId: id, toolUseId: tool });
      const prepared = loadRun(root, run.id);
      const result = await act({ run, input: run.input, worktree: prepared.worktree, prepared });
      return accept({ root, caller: id, run: run.id, result, toolUseId: `${tool}-ret-${Math.random()}`, github: gh.client, web });
    },
    close: () => gh.close()
  };
  return w;
}

/** A builder that commits in its worktree and opens (or pushes to) PR n at that commit; CI green unless told. */
export const builds = (w, n, { green = true, files = [], base = 'main' } = {}) => async ({ worktree }) => {
  const head = w.commit(worktree, `build for PR ${n}`);
  if (w.gh.state[n]) { w.gh.push(n, head); w.gh.state[n].files = files; } else w.gh.open(n, head, { files, base });
  if (green) w.gh.green(head);
  return { pr: { url: prUrl(n), at: head } };
};

/** A verifier that checks out target.at and returns `result`, restating its input's issue. */
export const verifies = (w, result = 'PASS') => async ({ input, worktree }) => {
  w.checkout(worktree, input.target.at);
  return { result, pr: { url: input.target.url, at: input.target.at }, issue: input.issue, report: `${result} on every line` };
};
export const BRIEFS = { builder: 'build it', verifier: 'verify it independently' };
