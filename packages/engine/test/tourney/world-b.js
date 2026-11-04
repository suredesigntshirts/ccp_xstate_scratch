// The stubbed world the design-B tournament scenarios drive: the real host (restore/offer), the real effects
// (merge, card, post, timer), real wakes (wake.js) and, where a scenario needs N3, the real agent actors
// (prepare/accept/deliver). Only the outside world is stubbed: GitHub (a local HTTP server that also answers
// compare), the web (pages by URL), the thread and clock (world.js platform), and agents' outputs.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { restore, offer, pending, itemFile, inputsOfWake, loadWorkflow } from '../../src/index.js';
import { handlers, github } from '../../src/effects/index.js';
import { readFile } from '../../../journal/src/index.js';
import { platform, tapWake, fresh, gitRepo } from '../parity/world.js';

export { restore, offer, pending, platform, tapWake, fresh, gitRepo, loadWorkflow, handlers };

export const RELEASE = '0.2.0';
export const A = 'a'.repeat(40);
export const B = 'b'.repeat(40);
export const C = 'c'.repeat(40);
export const MERGE_SHA = 'd'.repeat(40);
export const NOW = '2999-01-01T00:00:00Z';

export const prUrl = (n) => `https://github.com/o/r/pull/${n}`;
export const prOf = (n, headSha, branch = 'build/x') => ({ url: prUrl(n), branch, headSha });

/**
 * GitHub as a local server. PRs of o/r by number: { head, branch, base, merged }. GET pulls/<n>, PUT pulls/<n>/merge
 * (only at the head when a sha is sent; a merged PR answers 405), GET compare/<base>...<head> lists `files[head]`.
 * A merge into a PR's base moves `heads[base]` to a fresh merge sha. Every merge request is kept in `merges`.
 */
export async function fakeGitHub(prs = {}, files = {}) {
  const state = Object.fromEntries(Object.entries(prs).map(([n, p]) => [n, { merged: false, mergeSha: null, branch: 'build/x', base: 'main', ...p }]));
  const merges = [];
  let mergeN = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      const cmp = req.url.match(/^\/repos\/o\/r\/compare\/([^/]+)\.\.\.([^/]+)$/);
      if (cmp && req.method === 'GET') {
        const head = decodeURIComponent(cmp[2]);
        if (!(head in files)) return reply(404, { message: 'Not Found' });
        return reply(200, { files: files[head].map((filename) => ({ filename })) });
      }
      const m = req.url.match(/^\/repos\/o\/r\/pulls\/(\d+)(\/merge)?$/);
      const p = m && state[m[1]];
      if (!p) return reply(404, { message: 'Not Found' });
      if (req.method === 'GET' && !m[2]) {
        return reply(200, { number: Number(m[1]), merged: p.merged, merge_commit_sha: p.mergeSha, head: { sha: p.head, ref: p.branch }, base: { ref: p.base } });
      }
      const { sha } = JSON.parse(body || '{}');
      merges.push({ number: Number(m[1]), sha, base: p.base });
      if (p.merged) return reply(405, { message: 'Pull Request is not mergeable' });
      if (sha && sha !== p.head) return reply(409, { message: 'Head branch was modified. Review and try the merge again.' });
      p.merged = true;
      p.mergeSha = String(++mergeN).padStart(40, 'e');
      // The merge moves the base branch: an open PR whose head branch is that base is now at the merge commit.
      for (const other of Object.values(state)) if (!other.merged && other.branch === p.base) other.head = p.mergeSha;
      return reply(200, { sha: p.mergeSha, merged: true, message: 'Pull Request successfully merged' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    files,
    merges,
    push: (number, head) => { state[number].head = head; },
    open: (number, p) => { state[number] = { merged: false, mergeSha: null, branch: 'build/x', base: 'main', ...p }; },
    client: github({ api, env: {} }),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); })
  };
}

/** The web as the host's own fetch reaches it: pages by URL. */
export const fakeWeb = (pages) => ({ get: async (url) => { if (!(url in pages)) throw new Error(`${url} answered 404`); return pages[url]; } });

/**
 * Agent actors as stubs, by name: each run takes the next output queued for its actor (null leaves the run open,
 * as an agent still working would). Every run started is kept in `started`.
 */
export function agents(outputs, names = ['brief', 'build', 'verify', 'research', 'synthesize']) {
  const started = [];
  const left = Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, [...v]]));
  const handler = {
    start: async (effect) => {
      started.push(effect);
      const next = (left[effect.actor] ?? []).shift();
      return next == null ? { ref: effect.id } : { ref: effect.id, output: next };
    }
  };
  return { started, left, byActor: Object.fromEntries(names.map((n) => [n, handler])) };
}

export const open = (root, spec, { item = 'it-1', session = 'owner' } = {}) => restore({ root, item, spec, session, release: RELEASE });
export const start = (input, session = 'owner') => ({ event: { type: 'xstate.init', input }, source: { system: 'claude-code', ref: session } });
export const world = ({ gh = null, plat = platform(), actors = {} } = {}) =>
  handlers({ github: gh?.client ?? null, hearth: plat.hearth, clock: plat.clock, actors });

export const rows = (root, item = 'it-1') => readFile(itemFile(root, item)).rows;
export const transitions = (root, item = 'it-1') => rows(root, item).filter((r) => r.kind === 'engine.transition');
export const statesOf = (root, item = 'it-1') => transitions(root, item).filter((r) => r.payload.outcome === 'applied').sort((x, y) => x.payload.seq - y.payload.seq).map((r) => JSON.parse(r.state));

/** A GitHub wake carrying one event, as the platform delivers it, read through wake.js. */
export const githubWake = (kind, data, at = '2026-11-03T12:00:00Z') =>
  `<wake reason="external-event" current-time="${at}">\n  <event source="github" kind="${kind}" from="system" trust="relay">\n    ${JSON.stringify(data)}\n  </event>\n</wake>`;
export const ghInputs = (host, kind, data) => inputsOfWake(host, githubWake(kind, data), { now: NOW });
export const suite = (host, head, id = 1) => ghInputs(host, 'check_suite.completed', { head_sha: head, pr: 'o/r#1', check_suite_id: id });
export const red = (host, head, check = 'test') =>
  ghInputs(host, 'check_run.completed', { check, conclusion: 'failure', head_sha: head, details_url: `https://github.com/o/r/actions/runs/1/${check}`, pr: 'o/r#1' });
export const push = (host, before, after) => ghInputs(host, 'pull_request.synchronize', { before, after, pr: 'o/r#1' });

export const openRun = (host, actor) => pending(host).runs.find((r) => r.actor === actor) ?? null;
export const cardOf = (host, run) => host.effects.get(run.id)?.outcome?.ref ?? null;

/** The person taps option `index` on the open ask run's card: the decision-chosen wake, read through wake.js. */
export function tap(host, index = 0) {
  const run = openRun(host, 'ask');
  if (!run) throw new Error('no open ask run');
  return inputsOfWake(host, tapWake(cardOf(host, run), index, String.fromCharCode(65 + index)), { now: NOW });
}

/** The person's written answer on the open ask card (a replan's five whys): the ask run's completion. */
export function written(host, output, ref = 'cmsg_written') {
  const run = openRun(host, 'ask');
  if (!run) throw new Error('no open ask run');
  return [{ event: { type: 'xstate.done.actor.ask', output: { by: 'person', ...output } }, run: run.id, source: { system: 'hearth', ref } }];
}

/** An agent's late completion for a run id (a dead attempt's return). */
export const lateDone = (runId, invoke, output, ref = `late ${runId}`) =>
  [{ event: { type: `xstate.done.actor.${invoke}`, output }, run: runId, source: { system: 'harness', ref } }];

export const fixture = (name) => readFileSync(new URL(`../fixtures/wakes/${name}.txt`, import.meta.url), 'utf8');
