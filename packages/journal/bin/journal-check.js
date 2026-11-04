#!/usr/bin/env node
// The journal check (plan item obs-journal-vs-world). Compares the journal with a session's own event log and with
// GitHub's merged PRs, prints what is missing or unexplained, and with --record appends a journal.check row with the
// counts. Exit 0 when nothing is listed, 1 when something is, 2 when it couldn't run. docs/journal.md, "The journal
// check", has the usage.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { append, readAll, readFile } from '../src/index.js';
import { checkMerges, checkSession, clean, counts, parseEvents, prOf, report } from '../src/check.js';

// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, and a cloud session reaches GitHub only through
// its proxy, so the check runs itself again with it set.
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const again = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(again.status ?? 2);
}

const USAGE = `usage: journal-check.js --journal <root or file> [--session <session file>] [--events <file>]...
                        [--repo <owner/name>]... [--prs <file>] [--since <ISO time>] [--record <file>] [--json]

  --journal   journal rows: the journal root (every .jsonl under it) or one file
  --session   the session's own journal file, for the session diff (default: the --journal rows)
  --events    the session's event log: saved list_events pages, or a Claude Code transcript (its subagents/ folder,
              when there is one, is read too)
  --repo      a GitHub repository whose merged PRs must each have a pr.merge row
  --prs       GitHub's closed-PR responses saved as JSON, instead of asking GitHub (an array of PRs, or an object
              keyed by owner/name)
  --since     only merges and pr.merge rows from this time (default: the journal's first row)
  --record    append a journal.check row with the counts to this journal file
  --host      fail on any merge the host's merge effect didn't make (they are always listed)`;

function fail(message) {
  console.error(`journal-check: ${message}\n\n${USAGE}`);
  process.exit(2);
}

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      journal: { type: 'string' },
      session: { type: 'string' },
      events: { type: 'string', multiple: true, default: [] },
      repo: { type: 'string', multiple: true, default: [] },
      prs: { type: 'string' },
      since: { type: 'string' },
      record: { type: 'string' },
      host: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  }));
} catch (error) {
  fail(error.message);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!args.journal) fail('--journal is required');
if (!args.events.length && !args.repo.length) fail('give --events, --repo or both');
if (args.prs && !args.repo.length) fail('--prs needs the --repo it holds');

const rowsOf = (path) => (statSync(path).isDirectory() ? readAll(path) : readFile(path));

// A transcript's subagents sit beside it: <transcript without .jsonl>/subagents/agent-<id>.jsonl
function eventFiles(path) {
  const dir = join(path.replace(/\.jsonl$/, ''), 'subagents');
  if (!path.endsWith('.jsonl') || !existsSync(dir)) return [path];
  return [path, ...readdirSync(dir).filter((f) => /^agent-.*\.jsonl$/.test(f)).sort().map((f) => join(dir, f))];
}

async function closedPrs(repo, since) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'ccp-journal-check' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
    const prs = await res.json();
    out.push(...prs);
    // Sorted by last update, newest first: once a page ends before `since`, no later page can hold a newer merge.
    if (prs.length < 100 || (since && Date.parse(prs.at(-1).updated_at) < Date.parse(since))) break;
  }
  return out;
}

function savedPrs(path, repos) {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(saved)) {
    if (repos.length > 1) fail('--prs holds one array, so give one --repo, or key the file by owner/name');
    return { [repos[0]]: saved };
  }
  return saved;
}

// The harness release this check belongs to: the plugin's, whether bundled in it (lib/journal) or in the repo.
function release() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const root of [join(here, '..', '..', '..'), join(here, '..', '..', '..', 'plugins', 'harness')]) {
    try {
      return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    } catch {}
  }
  return '0.0.0';
}

const sessionName = (env = process.env) =>
  env.CLAUDE_CODE_REMOTE_SESSION_ID ? `https://claude.ai/code/${env.CLAUDE_CODE_REMOTE_SESSION_ID.replace(/^cse_/, 'session_')}` : 'unknown-session';

try {
  const journal = rowsOf(args.journal);
  const bad = [...journal.bad];
  const since = args.since ?? journal.rows[0]?.at ?? null;
  let session = null, merges = null;
  if (args.events.length) {
    const own = args.session ? readFile(args.session) : journal;
    if (args.session) bad.push(...own.bad);
    const events = args.events.flatMap(eventFiles).flatMap((f) => parseEvents(readFileSync(f, 'utf8')).events);
    session = checkSession({ rows: own.rows, events });
  }
  if (args.repo.length) {
    const byRepo = args.prs ? savedPrs(args.prs, args.repo) : {};
    const prs = [];
    for (const repo of args.repo) {
      const got = args.prs ? byRepo[repo] ?? fail(`--prs has nothing for ${repo}`) : await closedPrs(repo, since);
      prs.push(...got.map((pr) => prOf(repo, pr)));
    }
    merges = checkMerges({ rows: journal.rows, prs, repos: args.repo, since });
  }
  const result = { session, merges, bad, since, host: args.host };
  const ok = clean(result);
  if (args.record) {
    append(args.record, {
      kind: 'journal.check',
      source: { system: 'journal-check', ref: [args.events.length ? `events ${args.events.join(' ')}` : null, ...args.repo].filter(Boolean).join('; ') },
      session: sessionName(),
      agent: null,
      item: null,
      state: null,
      release: release(),
      payload: { ok, since, journal: args.journal, ...counts(result), badLines: bad.length },
    });
  }
  console.log(args.json ? JSON.stringify({ ok, ...result, counts: counts(result) }, null, 2) : report(result).join('\n'));
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`journal-check: ${error.message}`);
  process.exit(2);
}
