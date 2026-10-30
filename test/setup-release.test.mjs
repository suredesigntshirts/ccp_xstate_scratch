// The setup script's update path (plan item self-update-by-version), run for real against temp HOMEs and a temp clone
// of this repo whose origin carries release tags: it installs the newest release with that release's version,
// fast-forwards a clean clone, and never replaces the plugin of a Claude Code running from the same HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, TEST_REF, snapshot, temp } from '../plugins/harness/test/helpers.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (cwd, message) => {
  git(cwd, 'add', '-A');
  git(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message);
  return git(cwd, 'rev-parse', 'HEAD');
};

/** A clone of this repo's setup, plugin and journal (at TEST_REF) on main tracking a bare origin with `tags`. */
function clone(tags = []) {
  const dir = temp('clone');
  const origin = join(dir, 'origin.git'), cwd = join(dir, 'ccp_xstate');
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', cwd]);
  execFileSync('bash', ['-c', `git -C "${REPO}" archive ${TEST_REF} infra .claude plugins/harness packages/journal | tar -x -C "${cwd}"`]);
  commit(cwd, 'start');
  for (const v of tags) git(cwd, 'tag', `harness-v${v}`);
  git(cwd, 'remote', 'add', 'origin', origin);
  git(cwd, 'push', '-q', '--tags', '-u', 'origin', 'main');
  return cwd;
}

/** Another clone of origin that pushes one more commit to main, so `cwd` is behind. Returns the new sha. */
function advance(cwd, tag) {
  const other = join(temp('other'), 'c');
  execFileSync('git', ['clone', '-q', git(cwd, 'remote', 'get-url', 'origin'), other]);
  writeFileSync(join(other, 'plugins', 'harness', 'NEW.md'), 'new');
  const sha = commit(other, 'next');
  if (tag) git(other, 'tag', tag);
  git(other, 'push', '-q', '--tags', 'origin', 'main');
  return sha;
}

function run(cwd, { home = join(temp('home'), 'home'), env = {} } = {}) {
  mkdirSync(home, { recursive: true });
  const log = join(home, '..', `setup-${Math.random()}.log`);
  execFileSync('bash', [join(cwd, 'infra', 'cloud-environment', 'setup.sh')], { env: { ...process.env, HOME: home, CCP_SETUP_LOG: log, ...env } });
  const dest = join(home, '.claude', 'skills', 'ccp-harness');
  const json = (p) => { try { return JSON.parse(readFileSync(join(dest, p), 'utf8')); } catch { return null; } };
  return { home, dest, log: readFileSync(log, 'utf8'), manifest: json('.claude-plugin/plugin.json'), release: json('release.json') };
}

test('release: setup installs the newest release by version and the copy carries that version', () => {
  const cwd = clone(['0.4.2', '0.10.0', '0.9.9']);
  const r = run(cwd, { env: { CCP_SETUP_FETCH: '0' } });
  assert.equal(r.release.tag, 'harness-v0.10.0');
  assert.equal(r.release.version, '0.10.0');
  assert.equal(r.manifest.version, '0.10.0');
  assert.equal(r.release.commit, git(cwd, 'rev-parse', 'harness-v0.10.0^{commit}'));
});

test('release: a new release on origin is fetched and installed at the next container build', () => {
  const cwd = clone(['0.1.0']);
  const first = run(cwd);
  assert.equal(first.manifest.version, '0.1.0');
  const sha = advance(cwd, 'harness-v0.1.1');
  const next = run(cwd, { home: first.home });
  assert.equal(next.release.tag, 'harness-v0.1.1');
  assert.equal(next.manifest.version, '0.1.1');
  assert.equal(next.release.commit, sha);
  assert.ok(next.release.files.includes('NEW.md'));
});

test('fast-forward: a clean clone on main tracking origin/main is brought to origin/main', () => {
  const cwd = clone();
  const sha = advance(cwd);
  const r = run(cwd);
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), sha);
  assert.match(r.log, /clone fast-forwarded: main at /);
});

test('fast-forward: a clean clone detached at an ancestor of origin/main is moved, still detached', () => {
  const cwd = clone();
  git(cwd, 'checkout', '-q', '--detach');
  const sha = advance(cwd);
  const r = run(cwd);
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), sha);
  assert.match(r.log, /clone fast-forwarded: detached at /);
});

test('fast-forward: a dirty clone, another branch, or a diverged clone is left alone, saying why', () => {
  const dirty = clone();
  advance(dirty);
  const at = git(dirty, 'rev-parse', 'HEAD');
  writeFileSync(join(dirty, 'plugins', 'harness', 'README.md'), 'local edit');
  assert.match(run(dirty).log, /clone not fast-forwarded: it has uncommitted changes/);
  assert.equal(git(dirty, 'rev-parse', 'HEAD'), at);
  assert.equal(readFileSync(join(dirty, 'plugins', 'harness', 'README.md'), 'utf8'), 'local edit');

  const branch = clone();
  advance(branch);
  git(branch, 'checkout', '-q', '-b', 'work');
  assert.match(run(branch).log, /clone not fast-forwarded: branch work does not track origin\/main/);

  const diverged = clone();
  advance(diverged);
  git(diverged, 'checkout', '-q', '--detach');
  writeFileSync(join(diverged, 'mine.txt'), 'x');
  const mine = commit(diverged, 'mine');
  assert.match(run(diverged).log, /clone not fast-forwarded: HEAD is not an ancestor of origin\/main/);
  assert.equal(git(diverged, 'rev-parse', 'HEAD'), mine);
});

test('no-self-edit: setup leaves the plugin alone while Claude Code runs from the same HOME', async () => {
  const cwd = clone(['0.1.0']);
  const first = run(cwd);
  advance(cwd, 'harness-v0.1.1');
  const before = snapshot(first.dest);
  // A stand-in for the running Claude Code: a process whose HOME is this one, named by CLAUDE_PID as Claude Code does.
  const claude = spawn('sleep', ['30'], { env: { HOME: first.home } });
  try {
    const r = run(cwd, { home: first.home, env: { CLAUDE_PID: String(claude.pid) } });
    assert.match(r.log, new RegExp(`plugin not replaced: Claude Code \\(pid ${claude.pid}\\) is running from this HOME`));
    assert.deepEqual(snapshot(first.dest), before);
    // Another HOME, as in these tests or a fresh container, is installed as usual.
    assert.equal(run(cwd, { env: { CLAUDE_PID: String(claude.pid) } }).manifest.version, '0.1.1');
  } finally {
    claude.kill();
  }
});

test('release: a release branch on origin counts like a tag, and the newer of the two by version is installed', () => {
  const cwd = clone(['0.2.0']);
  const sha = advance(cwd);
  const origin = git(cwd, 'remote', 'get-url', 'origin');
  execFileSync('git', ['--git-dir', origin, 'update-ref', 'refs/heads/release/harness-v0.2.1', sha]);
  const r = run(cwd);
  assert.equal(r.release.tag, 'harness-v0.2.1');
  assert.equal(r.manifest.version, '0.2.1');
  assert.equal(r.release.commit, sha);
  execFileSync('git', ['--git-dir', origin, 'update-ref', 'refs/tags/harness-v0.10.0', sha]);
  assert.equal(run(cwd).manifest.version, '0.10.0');
});
