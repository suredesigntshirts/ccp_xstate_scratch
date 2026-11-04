// The world a parity test drives the host in (plan item parity-cases). The host is real: an item restored from its
// journal file and offered events through offer(), with the effect handlers from src/effects. Only GitHub and the
// platform are stubs: GitHub is a local HTTP server that the real REST client (src/effects/github.js) talks to, and
// the platform is the wake text it delivers (shaped as the real wakes in ../fixtures/wakes/) and a thread and clock
// that record the cards, posts and wakes the host asks for.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restore, offer, pending, itemFile, sessionFile } from '../../src/index.js';
import { handlers, github } from '../../src/effects/index.js';
import { merge } from '../../src/effects/merge.js';
export { merge };
import { readFile } from '../../../journal/src/index.js';
import { workflow, ISSUE, BRIEFS, A, B, pr, verdict } from '../flow.js';

export { workflow, ISSUE, BRIEFS, A, B, pr, verdict, restore, offer, pending, itemFile, sessionFile, handlers };
export const RELEASE = '0.2.0';
export const REPO = 'o/r';
export const PR_URL = 'https://github.com/o/r/pull/1';
export const MERGE_SHA = 'd'.repeat(40);

import { inputsOfWake } from '../../src/index.js';
export const inputsOfWakeFor = (host, text, now = '2999-01-01T00:00:00Z') => inputsOfWake(host, text, { now });
export const fresh = (name = 'parity') => mkdtempSync(join(tmpdir(), `${name}-`));
export const open = (root, { item = 'it-1', spec = workflow, session = 'owner', release = RELEASE } = {}) =>
  restore({ root, item, spec, session, release });
export const start = (session = 'owner', input = { issue: ISSUE }) =>
  ({ event: { type: 'xstate.init', input }, source: { system: 'claude-code', ref: session } });
export const rows = (root, item = 'it-1') => readFile(itemFile(root, item)).rows;
export const sessionRows = (root, session) => readFile(sessionFile(root, session)).rows;
export const transitions = (root, item = 'it-1') => rows(root, item).filter((r) => r.kind === 'engine.transition');
export const effectRows = (root, item = 'it-1') => rows(root, item).filter((r) => r.kind === 'engine.effect');

/**
 * GitHub as a local server: PRs of o/r by number, each { head, merged, mergeSha }. GET /repos/o/r/pulls/<n> reads
 * one; PUT /repos/o/r/pulls/<n>/merge merges it only at its head when a sha is sent, as the REST API does. `push`
 * moves a PR's head. Every merge request is kept in `merges`.
 */
export async function fakeGitHub(prs = { 1: { head: A } }) {
  const state = Object.fromEntries(Object.entries(prs).map(([n, p]) => [n, { merged: false, mergeSha: null, branch: 'build/x', ...p }]));
  const merges = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      const m = req.url.match(/^\/repos\/o\/r\/pulls\/(\d+)(\/merge)?$/);
      const p = m && state[m[1]];
      if (!p) return reply(404, { message: 'Not Found' });
      if (req.method === 'GET' && !m[2]) {
        return reply(200, { number: Number(m[1]), merged: p.merged, merge_commit_sha: p.mergeSha, head: { sha: p.head, ref: p.branch } });
      }
      const { sha } = JSON.parse(body || '{}');
      merges.push({ number: Number(m[1]), sha });
      if (p.merged) return reply(405, { message: 'Pull Request is not mergeable' });
      if (sha && sha !== p.head) return reply(409, { message: 'Head branch was modified. Review and try the merge again.' });
      p.merged = true;
      p.mergeSha = MERGE_SHA;
      return reply(200, { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    state,
    merges,
    push: (number, head) => { state[number].head = head; },
    api: `http://127.0.0.1:${server.address().port}`,
    client: github({ api: `http://127.0.0.1:${server.address().port}`, env: {} }),
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
    cards,
    posts,
    wakes,
    hearth: {
      card: async ({ key, question, choices }) => {
        const made = { key, ref: `cmsg_card${++n}`, question, choices };
        cards.push(made);
        return { ref: made.ref };
      },
      post: async ({ key, text }) => {
        const sent = { key, ref: `cmsg_post${++n}`, text };
        posts.push(sent);
        return { ref: sent.ref };
      },
      find: async (key) => cards.find((c) => c.key === key) ?? posts.find((p) => p.key === key) ?? null
    },
    clock: {
      wakeAt: async ({ key, due }) => {
        wakes.push({ key, due });
        return { ref: `wake ${key}` };
      }
    }
  };
}

/**
 * Agent actors (brief, build, verify) as stubs that finish with the next of their outputs, in turn, and once those
 * are used up leave the run open, as an agent still working would: the agents are the platform's, so a test says what
 * each returns. Each run started is kept in `started`.
 */
export function agents(outputs) {
  const started = [];
  const left = Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, [v].flat()]));
  const byActor = Object.fromEntries(['brief', 'build', 'verify'].map((name) => [name, {
    start: async (effect) => {
      started.push(effect);
      const queue = left[name] ?? [];
      return queue.length ? { ref: effect.id, output: queue.shift() } : { ref: effect.id };
    }
  }]));
  return { started, byActor };
}

/** The handlers a host runs with here: the real merge, card, post and timer effects over the stubs. */
export const world = ({ gh = null, plat = platform(), actors = {} } = {}) =>
  handlers({ github: gh?.client ?? null, hearth: plat.hearth, clock: plat.clock, actors });

// ---- Wakes, shaped as the platform delivers them (../fixtures/wakes/)

const fixture = (name) => readFileSync(new URL(`../fixtures/wakes/${name}.txt`, import.meta.url), 'utf8');

/** A decision-chosen wake: the person tapped option `index` on card `card`. */
export const tapWake = (card, index = 0, option = 'A') => fixture('tap-wake')
  .replace(/decision_id=[^<]*/, `decision_id=${card}`)
  .replace(/option=[^<]*/, `option=${option}`)
  .replace(/option_index=[^<]*/, `option_index=${index}`);

/** A check_run.completed wake, as the real one for ccp_xstate PR #27, for a check on a head. */
export const checkWake = ({ head, conclusion = 'failure', check = 'test', at = '2026-10-30T17:02:44Z' }) => {
  const real = fixture('check-run-failed');
  const json = JSON.parse(real.match(/\{"check"[^\n]*\}/)[0]);
  const now = JSON.stringify({ ...json, check, conclusion, head_sha: head, pr: 'o/r#1' });
  return real.replace(/\{"check"[^\n]*\}/, now).replace(/current-time="[^"]*"/, `current-time="${at}"`);
};

/** An empty wake at a time: a send_later or any later wake, which fires the timers due by then. */
export const timeWake = (at) => `<wake reason="scheduled" current-time="${at}">\n</wake>`;

/** The open run of an actor, if any. */
export const openRun = (host, actor) => pending(host).runs.find((r) => r.actor === actor) ?? null;
/** The card the ask run put up: its effect's outcome ref. */
export const cardOf = (host, run) => host.effects.get(run.id)?.outcome?.ref ?? null;

/** An item of quick-fix taken to awaitingMerge at head `head`, its card up in the stub thread. */
export async function toAwaitingMerge({ root = fresh(), head = A, gh = null, plat = platform(), session = 'owner' } = {}) {
  const host = open(root, { session });
  const a = agents({ brief: BRIEFS, build: pr(head), verify: verdict('PASS', head) });
  const effects = world({ gh, plat, actors: a.byActor });
  await offer(host, [start(session)], effects);
  return { root, host, plat, effects, agents: a };
}

/** An agent's result for the item's open run of `actor`, as the harness's return hook hands it over. */
export const returned = (host, actor, output, ref = `return ${actor}`) => {
  const run = openRun(host, actor);
  if (!run) throw new Error(`no open ${actor} run`);
  return { event: { type: `xstate.done.actor.${run.invoke}`, output }, run: run.id, source: { system: 'harness', ref } };
};

import { hashOf } from '../../src/index.js';
/** The hash of what the item is now: its state and context. */
export const hashOfHost = (host) => hashOf(host.snapshot);

// ---- bin/host.js, as a session or a hook runs it

import { spawn as spawnChild } from 'node:child_process';
const CLI = new URL('../../bin/host.js', import.meta.url).pathname;

/** Run bin/host.js on item it-1 of quick-fix under root; resolves { status, stdout, stderr }. Never blocks this process. */
export const hostCli = (root, args, { input = '', env = {}, release = RELEASE, item = 'it-1' } = {}) => new Promise((ok) => {
  const child = spawnChild(process.execPath, [CLI, ...args, '--item', item, '--workflow', 'quick-fix', '--root', root, '--release', release],
    { env: { ...process.env, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));
  child.on('close', (status) => ok({ status, stdout, stderr }));
  child.stdin.end(input);
});

import { execFileSync } from 'node:child_process';
/** A git repo with one commit, the clone an agent actor's worktree is added from. */
export function gitRepo() {
  const dir = fresh('parity-repo');
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one']);
  return dir;
}
