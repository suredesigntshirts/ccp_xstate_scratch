// The world the D-wildcard scenario tests drive the real host in. Only the outside is stubbed: GitHub is a local HTTP
// server the real REST client talks to (now with base and files), source pages are a local HTTP server the real
// fetchText reads, the thread and clock record cards/posts/wakes, and agents leave their runs open until a test hands
// their result over. A result reaches the item with `seen` computed by the real attest(), as resultsOf would give it.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restore, offer, pending, itemFile, loadWorkflow, inputsOfWake } from '../../src/index.js';
import { handlers, github, fetchText, items } from '../../src/effects/index.js';
import { attest } from '../../src/actors.js';
import { readFile } from '../../../journal/src/index.js';
import { platform, fresh, tapWake, checkWake, timeWake, cardOf, MERGE_SHA } from '../parity/world.js';

export { platform, fresh, tapWake, checkWake, timeWake, cardOf, MERGE_SHA, offer, pending, loadWorkflow };
export const RELEASE = '0.2.0';
export const A = 'a'.repeat(40);
export const B = 'b'.repeat(40);
export const C = 'c'.repeat(40);
export const D = 'd'.repeat(40);
export const X = 'e'.repeat(40);
export const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
export const BRIEFS = { builder: 'build multiply', verifier: 'check multiply against the issue' };
export const prUrl = (n) => `https://github.com/o/r/pull/${n}`;
export const prOut = (n, head, branch = 'build/x') => ({ url: prUrl(n), branch, headSha: head });
export const verdictOut = (result, n, head) => ({ result, pr: { url: prUrl(n), headSha: head }, report: `${result} at ${head.slice(0, 7)}` });

export const inputsOfWakeFor = (host, text, now = '2999-01-01T00:00:00Z') => inputsOfWake(host, text, { now });
export const rows = (root, item) => readFile(itemFile(root, item)).rows;
export const transitions = (root, item) => rows(root, item).filter((r) => r.kind === 'engine.transition');
export const openRun = (host, actor) => pending(host).runs.find((r) => r.actor === actor) ?? null;
export const openRunOf = (host, invoke) => pending(host).runs.find((r) => r.invoke === invoke) ?? null;

/** GitHub as a local server: PRs of o/r, each { head, branch, base, files, merged }. GET pull, GET files, PUT merge. */
export async function fakeGitHub(prs = { 1: { head: A } }) {
  const state = Object.fromEntries(Object.entries(prs).map(([n, p]) => [n, { merged: false, mergeSha: null, branch: 'build/x', base: 'main', files: ['src/x.js'], ...p }]));
  const merges = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      const m = req.url.match(/^\/repos\/o\/r\/pulls\/(\d+)(\/merge|\/files)?$/);
      const p = m && state[m[1]];
      if (!p) return reply(404, { message: 'Not Found' });
      if (req.method === 'GET' && !m[2]) {
        return reply(200, { number: Number(m[1]), merged: p.merged, merge_commit_sha: p.mergeSha, head: { sha: p.head, ref: p.branch }, base: { ref: p.base, repo: { default_branch: 'main' } } });
      }
      if (req.method === 'GET' && m[2] === '/files') return reply(200, p.files.map((filename) => ({ filename })));
      const { sha } = JSON.parse(body || '{}');
      merges.push({ number: Number(m[1]), sha, base: p.base });
      if (p.merged) return reply(405, { message: 'Pull Request is not mergeable' });
      if (sha && sha !== p.head) return reply(409, { message: 'Head branch was modified. Review and try the merge again.' });
      p.merged = true;
      p.mergeSha = MERGE_SHA;
      return reply(200, { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${server.address().port}`;
  return {
    state, merges, api,
    add: (n, p) => { state[n] = { merged: false, mergeSha: null, branch: 'build/x', base: 'main', files: ['src/x.js'], ...p }; },
    push: (n, head) => { state[n].head = head; },
    client: github({ api, env: {} }),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); })
  };
}

/** Source pages as a local server: { '/path': 'text' }. url(path) is the page's full URL. */
export async function fakeWeb(pages) {
  const server = createServer((req, res) => {
    const text = pages[req.url];
    if (text === undefined) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(text);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: (path) => base + path,
    fetchText: (href) => fetchText(href, { env: {} }),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); })
  };
}

/** Agent actors that leave their runs open, as agents still working: each start is kept in `started`. */
export function agents() {
  const started = [];
  const byActor = Object.fromEntries(['brief', 'build', 'verify'].map((name) => [name, {
    start: async (effect) => { started.push(effect); return { ref: effect.id }; }
  }]));
  return { started, byActor };
}

/**
 * One world over a journal root: every item (parent or child) runs its effects with the same handlers, including the
 * real items effect. open(item, spec?) restores an item as `session`.
 */
export function world({ root = fresh('tourney'), gh = null, plat = platform(), session = 'owner' } = {}) {
  const a = agents();
  let h;
  const itemsHandler = items({ root, session, release: RELEASE, handlersFor: () => h });
  h = handlers({ github: gh?.client ?? null, hearth: plat.hearth, clock: plat.clock, actors: a.byActor, items: itemsHandler });
  const open = (item, spec = loadWorkflow('quick-fix'), as = session) => restore({ root, item, spec, session: as, release: RELEASE });
  const startItem = async (item, input, spec = loadWorkflow('quick-fix')) => {
    const host = open(item, spec);
    const results = await offer(host, [{ event: { type: 'xstate.init', input }, source: { system: 'claude-code', ref: `${session} ${item}` } }], h);
    return { host, results };
  };
  /** Offer inputs to the item, reopened from its journal first. */
  const send = async (item, inputs, spec) => {
    const host = open(item, spec);
    const results = await offer(host, inputs, h);
    return { host: open(item, spec), results };
  };
  /** advance() the item's open items runs and offer what completes. */
  const advance = async (item, spec) => {
    const host = open(item, spec);
    const inputs = await itemsHandler.advance(host);
    const results = inputs.length ? await offer(host, inputs, h) : [];
    return { inputs, results, host: open(item, spec) };
  };
  return { root, gh, plat, session, agents: a, handlers: h, itemsHandler, open, startItem, send, advance };
}

/**
 * The host input resultsOf would give for an agent's result on the item's open run of `invoke`: the done event with
 * the result as output and `seen` from the real attest(). Returns { input } or { refused }.
 */
export async function attested(host, invoke, output, { gh = null, worktreeHead = null, web = null } = {}) {
  const run = openRunOf(host, invoke);
  if (!run) throw new Error(`no open ${invoke} run on ${host.item} in ${JSON.stringify(host.snapshot?.value)}`);
  const got = await attest({ root: host.root, result: output, worktreeHead, github: gh?.client, fetchText: web?.fetchText });
  if (got.refused) return { refused: got.refused };
  return { input: { event: { type: `xstate.done.actor.${invoke}`, output, ...(got.seen ? { seen: got.seen } : {}) }, run: run.id, source: { system: 'harness', ref: `return ${run.id}` } } };
}

/** An agent result with nothing to attest (a brief), as resultsOf gives it. */
export const returned = (host, invoke, output) => {
  const run = openRunOf(host, invoke);
  if (!run) throw new Error(`no open ${invoke} run on ${host.item} in ${JSON.stringify(host.snapshot?.value)}`);
  return { event: { type: `xstate.done.actor.${invoke}`, output }, run: run.id, source: { system: 'harness', ref: `return ${run.id}` } };
};

/** An actor's error on its open run, as resultsOf gives it for a run whose agent stopped without returning. */
export const errored = (host, invoke, error = 'the actor ended without returning') => {
  const run = openRunOf(host, invoke);
  if (!run) throw new Error(`no open ${invoke} run`);
  return { event: { type: `xstate.error.actor.${invoke}`, error }, run: run.id, source: { system: 'harness', ref: `stop ${run.id}` } };
};

const fixture = (name) => readFileSync(new URL(`../fixtures/wakes/${name}.txt`, import.meta.url), 'utf8');
/** The check_suite.completed wake from the fixture, on a head of o/r#n. */
export const suiteWake = (head, n = 1) => fixture('check-suite-completed').replace(/\{"head_sha"[^\n]*\}/, JSON.stringify({ head_sha: head, pr: `o/r#${n}` }));
/** The pull_request.closed (merged) wake from the fixture, for o/r#n. */
export const mergedWake = (n = 1) => fixture('pr-merged').replace(/\{"outcome"[^\n]*\}/, JSON.stringify({ outcome: 'merged', pr: `o/r#${n}` }));
/** A red check_run wake on a head of o/r#n. */
export const redWake = (head, n = 1) => checkWake({ head }).replace(/"pr":"o\/r#1"/, `"pr":"o/r#${n}"`);

/** The person's tap on the item's open ask run (by invoke), as the platform's tap wake gives it. */
export const tap = (host, invoke, index) => {
  const run = openRunOf(host, invoke);
  if (!run) throw new Error(`no open ${invoke} card on ${host.item}`);
  return inputsOfWakeFor(host, tapWake(cardOf(host, run), index));
};
/** The person's replan answer with a written why on the replan card (the card's tap cannot carry text). */
export const replanWithWhy = (host, why) => {
  const run = openRunOf(host, 'replan');
  return [{ event: { type: 'xstate.done.actor.replan', output: { choice: 'replan', by: 'person', why } }, run: run.id, source: { system: 'hearth', ref: cardOf(host, run) } }];
};

export const fileExists = (root, item) => existsSync(itemFile(root, item));
export const blobPath = (root, hash) => join(root, 'blobs', hash);
