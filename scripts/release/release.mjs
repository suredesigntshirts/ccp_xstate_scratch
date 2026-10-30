#!/usr/bin/env node
// Makes a harness release on a push to main (plan item self-update-by-version): when the push changed what the setup
// script copies into a session (plugins/harness and packages/journal, tests aside), it tags the pushed sha
// harness-v<x.y.z>. The version only rises: it is the newest tag's patch + 1, or the version in
// plugins/harness/.claude-plugin/plugin.json when that is higher (so a minor or major bump is made by editing it).
// No commit is made: the tag carries the version, and setup.sh writes it into the copy's plugin.json.
// The tag is annotated with a ci.result journal row (docs/journal.md) that says what was released and why.
//
//   node scripts/release/release.mjs plan                  prints the decision as JSON, changes nothing
//   node scripts/release/release.mjs tag [--push]          also makes the tag (and pushes it to origin)
//
// Reads BEFORE_SHA (the push's before sha, used when no release tag exists yet), GITHUB_SHA, GITHUB_RUN_ID and
// GITHUB_SERVER_URL/GITHUB_REPOSITORY from the environment, as .github/workflows/release.yml gives them.
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

/** The newest harness-v<x.y.z> tag among `tags`, as { tag, version }, or null. */
export function newestTag(tags) {
  const versions = tags.map((t) => t.match(new RegExp(`^${TAG_PREFIX}(\\d+\\.\\d+\\.\\d+)$`))?.[1]).filter(Boolean);
  if (!versions.length) return null;
  const version = versions.sort(compare).at(-1);
  return { tag: `${TAG_PREFIX}${version}`, version };
}

/**
 * Decides a release for `sha` in the repo at `cwd`. The base is the newest release tag when there is one (so a
 * release a failed run missed is made by the next push), else `before`. Returns
 * { release: bool, reason, sha, base, latest, version, tag, changed }.
 */
export function plan({ cwd = process.cwd(), sha = 'HEAD', before = null } = {}) {
  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const lines = (s) => s.split('\n').filter(Boolean);
  sha = git('rev-parse', `${sha}^{commit}`);
  const latest = newestTag(lines(git('tag', '-l', `${TAG_PREFIX}*`)));
  const at = lines(git('tag', '-l', `${TAG_PREFIX}*`, '--points-at', sha));
  const out = { release: false, sha, latest: latest?.version ?? null, base: null, version: null, tag: null, changed: [] };
  if (at.length) return { ...out, reason: `${sha.slice(0, 12)} is already released as ${at.join(', ')}` };
  let base = latest?.tag ?? (before && !ZERO.test(before) ? before : null);
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

/** The ci.result journal row for a decision, validated. */
export function row(decision, env = process.env) {
  const run = env.GITHUB_RUN_ID ?? 'local';
  const url = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${run}` : null;
  const r = {
    v: VERSION,
    id: `release-${decision.sha}`,
    at: new Date().toISOString(),
    kind: 'ci.result',
    source: { system: 'github', ref: String(run) },
    session: url ?? `release-run-${run}`,
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
  const decision = plan({ sha: process.env.GITHUB_SHA || 'HEAD', before: process.env.BEFORE_SHA || null });
  if (cmd === 'plan') {
    console.log(JSON.stringify(decision, null, 2));
  } else if (cmd === 'tag') {
    const r = tag(decision, { push: flag === '--push' });
    console.log(JSON.stringify(r));
    console.error(decision.release ? `released ${decision.tag} at ${decision.sha}` : `no release: ${decision.reason}`);
  } else {
    console.error('usage: release.mjs plan | tag [--push]');
    process.exit(2);
  }
}
