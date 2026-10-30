#!/usr/bin/env node
// Makes a harness release after a merge to main (plan item self-update-by-version): when the merge changed what the
// setup script copies into a session (plugins/harness and packages/journal, tests aside), it names the merged sha
// harness-v<x.y.z>. The version only rises: it is the newest release's patch + 1, or the version in
// plugins/harness/.claude-plugin/plugin.json when that is higher (so a minor or major bump is made by editing it).
// No commit is made: the release ref carries the version, and setup.sh writes it into the copy's plugin.json.
//
// A release is either of two refs, and every reader (this script, setup.sh, the plugin) takes both:
//   refs/heads/release/harness-v<x.y.z>   a release branch, which a thread pushes right after it merges (the git proxy
//                                         drops tag pushes from threads, but lets branch pushes through)
//   refs/tags/harness-v<x.y.z>            an annotated tag, which .github/workflows/release.yml makes when Actions runs
// Each carries a ci.result journal row (docs/journal.md): the tag in its annotation, the branch in the script's output.
//
//   node scripts/release/release.mjs plan              prints the decision as JSON, changes nothing
//   node scripts/release/release.mjs branch [--push]   makes the release branch (and pushes it to origin)
//   node scripts/release/release.mjs tag [--push]      makes the annotated tag (and pushes it to origin)
//
// Run it from a clone with origin/main fetched; it fetches origin's release refs itself. It releases RELEASE_SHA, else
// GITHUB_SHA, else origin/main. BEFORE_SHA (the push's before sha) is the base when no release exists yet; Actions
// gives it, and without it the base is the sha's first parent, which for a merge commit is main before the merge.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, VERSION } from '../../packages/journal/src/index.js';

export const TAG_PREFIX = 'harness-v';
/** What setup.sh copies into a session, as git pathspecs. A change here is a plugin change. */
export const RELEASED = ['plugins/harness', 'packages/journal', ':(exclude)plugins/harness/test', ':(exclude)packages/journal/test'];
const MANIFEST = 'plugins/harness/.claude-plugin/plugin.json';
const ZERO = /^0+$/;

const parse = (v) => v.split('.').map(Number);
export function compare(a, b) {
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The next version: the manifest's when it is above the newest release, else the newest release's patch + 1. */
export function nextVersion(latest, manifest) {
  if (!latest) return manifest;
  const [x, y, z] = parse(latest);
  const bumped = `${x}.${y}.${z + 1}`;
  return compare(manifest, bumped) > 0 ? manifest : bumped;
}

/** The release refs a clone can see: tags, local release branches and origin's release branches. */
export const RELEASE_REFS = [`refs/tags/${TAG_PREFIX}*`, `refs/heads/release/${TAG_PREFIX}*`, `refs/remotes/origin/release/${TAG_PREFIX}*`];

/** The release name (harness-v<x.y.z>) a ref names, or null. */
export const releaseName = (ref) => ref.match(new RegExp(`(?:^|/)(${TAG_PREFIX}\\d+\\.\\d+\\.\\d+)$`))?.[1] ?? null;

/** The newest release among `refs` (tag names or full ref names), as { tag, version, ref }, or null. */
export function newestTag(refs) {
  const found = refs.map((ref) => ({ ref, name: releaseName(ref) })).filter((r) => r.name)
    .map((r) => ({ ...r, version: r.name.slice(TAG_PREFIX.length) }));
  if (!found.length) return null;
  const { ref, version } = found.sort((a, b) => compare(a.version, b.version)).at(-1);
  return { tag: `${TAG_PREFIX}${version}`, version, ref };
}

/**
 * Decides a release for `sha` in the repo at `cwd`. The base is the newest release when there is one (so a release
 * a missed run would have made is made by the next one), else `before`, else the sha's first parent. Returns
 * { release: bool, reason, sha, base, latest, version, tag, changed }.
 */
export function plan({ cwd = process.cwd(), sha = 'HEAD', before = null } = {}) {
  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const lines = (s) => s.split('\n').filter(Boolean);
  sha = git('rev-parse', `${sha}^{commit}`);
  const refs = (...extra) => lines(git('for-each-ref', '--format=%(refname)', ...extra, ...RELEASE_REFS));
  const latest = newestTag(refs());
  const at = [...new Set(refs('--points-at', sha).map(releaseName))];
  const out = { release: false, sha, latest: latest?.version ?? null, base: null, version: null, tag: null, changed: [] };
  if (at.length) return { ...out, reason: `${sha.slice(0, 12)} is already released as ${at.join(', ')}` };
  let base = latest?.ref ?? (before && !ZERO.test(before) ? before : null);
  if (!base) {
    try { base = git('rev-parse', `${sha}^`); } catch { base = null; }
  }
  out.base = base ? git('rev-parse', `${base}^{commit}`) : null;
  out.changed = out.base
    ? lines(git('diff', '--name-only', out.base, sha, '--', ...RELEASED))
    : lines(git('ls-tree', '-r', '--name-only', sha, '--', ...RELEASED));
  if (!out.changed.length) return { ...out, reason: `nothing under plugins/harness or packages/journal changed since ${base ? (latest?.tag ?? base.slice(0, 12)) : 'the root'}` };
  const manifest = JSON.parse(git('show', `${sha}:${MANIFEST}`)).version;
  const version = nextVersion(latest?.version ?? null, manifest);
  if (latest && compare(version, latest.version) <= 0) throw new Error(`refused: ${version} is not above ${latest.version}`);
  return { ...out, release: true, version, tag: `${TAG_PREFIX}${version}`, reason: `${out.changed.length} released file(s) changed since ${latest?.tag ?? out.base.slice(0, 12)}` };
}

/**
 * The ci.result journal row for a decision, validated. From Actions it names the run; from a thread, the thread's
 * Claude-Session (CLAUDE_CODE_REMOTE_SESSION_ID) and the release ref.
 */
export function row(decision, env = process.env) {
  const run = env.GITHUB_RUN_ID ?? null;
  const url = run && env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${run}` : null;
  const thread = env.CLAUDE_CODE_REMOTE_SESSION_ID ? `https://claude.ai/code/${env.CLAUDE_CODE_REMOTE_SESSION_ID.replace(/^cse_/, 'session_')}` : null;
  const r = {
    v: VERSION,
    id: `release-${decision.sha}`,
    at: new Date().toISOString(),
    kind: 'ci.result',
    source: run ? { system: 'github', ref: String(run) } : { system: 'git', ref: decision.tag ? `release/${decision.tag}` : decision.sha },
    session: url ?? thread ?? 'release-script',
    agent: null,
    item: null,
    state: null,
    release: decision.version ?? decision.latest ?? '0.0.0',
    payload: {
      workflow: 'release',
      sha: decision.sha,
      result: decision.release ? 'released' : 'skipped',
      reason: decision.reason,
      tag: decision.tag,
      version: decision.version,
      previous: decision.latest,
      changed: decision.changed
    }
  };
  const errors = validate(r);
  if (errors.length) throw new Error(`ci.result row is invalid: ${errors.join('; ')}`);
  return r;
}

/** Makes the release branch release/<tag> at the sha (and pushes it when `push`). Returns the row. */
export function branch(decision, { cwd = process.cwd(), push = false, env = process.env } = {}) {
  const r = row(decision, env);
  if (!decision.release) return r;
  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('branch', `release/${decision.tag}`, decision.sha);
  if (push) git('push', 'origin', `refs/heads/release/${decision.tag}:refs/heads/release/${decision.tag}`);
  return r;
}

/** Makes the annotated tag (and pushes it when `push`). Returns the row. */
export function tag(decision, { cwd = process.cwd(), push = false, env = process.env } = {}) {
  const r = row(decision, env);
  if (!decision.release) return r;
  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('-c', 'user.name=ccp-release', '-c', 'user.email=ccp-release@users.noreply.github.com',
    'tag', '-a', decision.tag, decision.sha, '-m', `${decision.tag}\n\n${JSON.stringify(r)}`);
  if (push) git('push', 'origin', `refs/tags/${decision.tag}`);
  return r;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, flag] = process.argv.slice(2);
  const make = { branch, tag }[cmd];
  if (cmd !== 'plan' && !make) {
    console.error('usage: release.mjs plan | branch [--push] | tag [--push]');
    process.exit(2);
  }
  try {
    execFileSync('git', ['fetch', '-q', '--tags', 'origin', `+refs/heads/release/${TAG_PREFIX}*:refs/remotes/origin/release/${TAG_PREFIX}*`], { stdio: 'ignore', timeout: 30000 });
  } catch {
    console.error('release refs not fetched from origin; deciding from the refs this clone has');
  }
  const sha = process.env.RELEASE_SHA || process.env.GITHUB_SHA || 'origin/main';
  const decision = plan({ sha, before: process.env.BEFORE_SHA || null });
  if (cmd === 'plan') {
    console.log(JSON.stringify(decision, null, 2));
  } else {
    const r = make(decision, { push: flag === '--push' });
    console.log(JSON.stringify(r));
    console.error(decision.release ? `released ${decision.tag} at ${decision.sha} as a ${cmd}` : `no release: ${decision.reason}`);
  }
}
