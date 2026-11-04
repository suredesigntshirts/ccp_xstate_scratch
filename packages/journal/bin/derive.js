#!/usr/bin/env node
// The derived views on the command line (plan item obs-time-and-rework). docs/journal.md, "Derived views".
//   derive.js time --journal <file|root>
//   derive.js rework --repo <owner/repo> --pr <n> [--pr <n> ...] [--facts <file>] [--save-facts <file>]
//                    [--plan <items dir>] [--checks a,b] [--append <journal file> --session <id> --release <x.y.z>]
//   derive.js overhead --journal <file|root> --facts <file> [--config <harness-paths.json>]
// rework reads PR facts from GitHub REST (repo-scoped reads need no token; set NODE_USE_ENV_PROXY=1 behind a proxy),
// or from --facts, a file an earlier --save-facts wrote. With --append it appends the ci.result rows the journal
// lacks and any new tripwire rows. Every command prints its view as JSON. Exit 0, or 2 on a usage or read error.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { append, readAll, readFile } from '../src/index.js';
import { time } from '../src/derive/time.js';
import { ciRows, rework, tripwires, DEFAULT_LIMIT } from '../src/derive/rework.js';
import { overhead } from '../src/derive/overhead.js';

const [command, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, '');
  opts[key] = key === 'pr' ? [...(opts.pr ?? []), Number(rest[i + 1])] : rest[i + 1];
}
const fail = (msg) => { console.error(`derive: ${msg}`); process.exit(2); };
const journal = (path) => {
  if (!path) return [];
  if (!existsSync(path)) fail(`no journal at ${path}`);
  return (statSync(path).isDirectory() ? readAll(path) : readFile(path)).rows;
};

/** One PR's facts from GitHub REST: its item, labels, sessions (Claude-Session trailers), files and commits with their check runs. */
export async function prFacts(repo, number, { get = restGet } = {}) {
  const pr = await get(`/repos/${repo}/pulls/${number}`);
  const commits = await pages(get, `/repos/${repo}/pulls/${number}/commits`);
  const files = await pages(get, `/repos/${repo}/pulls/${number}/files`);
  const out = [];
  for (const c of commits) {
    const runs = await get(`/repos/${repo}/commits/${c.sha}/check-runs?per_page=100`);
    out.push({
      sha: c.sha, parents: c.parents.length, at: c.commit.committer.date,
      checkRuns: runs.check_runs.map((r) => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, startedAt: r.started_at, completedAt: r.completed_at })),
    });
  }
  const sessions = [...new Set(commits.flatMap((c) => [...c.commit.message.matchAll(/^Claude-Session:\s*\S*?(session_[A-Za-z0-9]+)\s*$/gm)].map((m) => m[1])))];
  return {
    repo, number, head: pr.head.ref, merged: !!pr.merged_at, item: itemOf(pr), labels: pr.labels.map((l) => l.name),
    sessions, files: files.map((f) => ({ path: f.filename, changes: f.changes })), commits: out,
  };
}

// The item a PR names, as the PR gates read it: an `Item: <id>` line in the body, else the branch's last segment.
const itemOf = (pr) => pr.body?.match(/^Item:\s*([a-z0-9-]+)\s*$/m)?.[1] ?? pr.head.ref.split('/').pop();

async function restGet(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub REST ${path}: ${res.status}`);
  return res.json();
}

async function pages(get, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await get(`${path}?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

// An item's round limit is its head's step_back.max_rounds.
const limitFrom = (dir) => (pr) => {
  const path = dir && pr.item && join(dir, `${pr.item}.md`);
  if (!path || !existsSync(path)) return DEFAULT_LIMIT;
  const head = readFileSync(path, 'utf8').match(/```json\n([\s\S]*?)\n```/)?.[1];
  try { return JSON.parse(head).step_back?.max_rounds ?? DEFAULT_LIMIT; } catch { return DEFAULT_LIMIT; }
};

async function main() {
  if (command === 'time') {
    if (!opts.journal) fail('time needs --journal');
    return time(journal(opts.journal));
  }
  if (command === 'rework') {
    let facts;
    if (opts.facts) facts = JSON.parse(readFileSync(opts.facts, 'utf8'));
    else {
      if (!opts.repo || !opts.pr?.length) fail('rework needs --repo and --pr, or --facts');
      facts = [];
      for (const n of opts.pr) facts.push(await prFacts(opts.repo, n));
    }
    if (opts['save-facts']) writeFileSync(opts['save-facts'], JSON.stringify(facts, null, 2) + '\n');
    const envelope = { session: opts.session ?? 'derive', release: opts.release ?? '0.0.0' };
    const existing = journal(opts.append && existsSync(opts.append) ? opts.append : null);
    const have = new Set(existing.map((r) => r.id));
    const fresh = facts.flatMap((f) => ciRows(f, envelope)).filter((r) => !have.has(r.id));
    const rows = [...existing, ...fresh];
    const view = rework(rows, { checks: opts.checks?.split(',') });
    const trips = tripwires(view, rows, envelope, { limitOf: limitFrom(opts.plan) });
    if (opts.append) {
      if (!opts.session || !opts.release) fail('--append needs --session and --release');
      for (const r of [...fresh, ...trips]) append(opts.append, r);
    }
    return { ...view, tripwires: trips.map((t) => t.payload) };
  }
  if (command === 'overhead') {
    if (!opts.journal || !opts.facts) fail('overhead needs --journal and --facts');
    const config = JSON.parse(readFileSync(opts.config ?? new URL('../harness-paths.json', import.meta.url), 'utf8'));
    return overhead(journal(opts.journal), JSON.parse(readFileSync(opts.facts, 'utf8')), config);
  }
  fail('usage: derive.js time|rework|overhead ... (see the head of this file)');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((out) => console.log(JSON.stringify(out, null, 2)), (err) => fail(err.message));
}
