// Test fixtures: a temp HOME with the plugin installed by the real setup script, a temp project folder, and a temp
// repo clone whose origin carries release tags and the settings the session should have.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = join(PLUGIN, '..', '..');
export const SETUP = join(REPO, 'infra', 'cloud-environment', 'setup.sh');
export const RULES = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8')).autoMode.allow;

export const temp = (name) => mkdtempSync(join(tmpdir(), `ccp-harness-${name}-`));

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The commit setup.sh installs in tests: the working tree as a commit (git stash create) when it has changes,
// else HEAD, so an uncommitted change is tested too.
// Test files run in parallel and each makes it, and `git stash create` can find another's index.lock, so it retries.
export const TEST_REF = (() => {
  for (let i = 0; ; i++) {
    try {
      return execFileSync('git', ['-C', REPO, 'stash', 'create'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || 'HEAD';
    } catch (error) {
      if (i >= 20) throw error;
      execFileSync('sleep', ['0.2']);
    }
  }
})();

/** Runs the real setup script with HOME at `home`, installing TEST_REF without fetching tags. Returns the log text. */
export function setup(home, extraEnv = {}) {
  const log = join(home, '..', `setup-${Date.now()}-${Math.random()}.log`);
  execFileSync('bash', [SETUP], { env: { ...process.env, HOME: home, CCP_SETUP_LOG: log, CCP_SETUP_FETCH: '0', CCP_SETUP_REF: TEST_REF, ...extraEnv } });
  return readFileSync(log, 'utf8');
}

/** A repo clone with .claude/settings.json holding `rules`, and an origin carrying `tags` (versions). */
export function fakeRepo({ rules = RULES, tags = [] } = {}) {
  const dir = temp('repo');
  const origin = join(dir, 'origin.git');
  const clone = join(dir, 'clone');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['init', '-q', clone]);
  mkdirSync(join(clone, '.claude'));
  writeFileSync(join(clone, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3' }, autoMode: { allow: rules } }));
  git(clone, 'add', '-A');
  git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'settings');
  for (const v of tags) git(clone, 'tag', `harness-v${v}`);
  git(clone, 'remote', 'add', 'origin', origin);
  // Shares this repo's objects, so the release check can compare an installed commit with the fake releases.
  writeFileSync(join(clone, '.git', 'objects', 'info', 'alternates'), `${git(REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim()}/objects\n`);
  git(clone, 'push', '-q', '--tags', 'origin', 'HEAD:refs/heads/main');
  return clone;
}

/** Writes ~/.claude/settings.json under `home`. */
export function writeSettings(home, settings) {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings));
}

/** Runs a hook script with `input` on stdin. Returns { status, stdout, stderr }. */
export function runHook(script, { env = {}, input = {} } = {}) {
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 15000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Every file under `dir` with its size and mtime, to show that nothing was written. */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out[p] = `${s.size}:${s.mtimeMs}`;
    }
  };
  walk(dir);
  return out;
}

/** The context line a SessionStart hook's JSON output gives the session. */
export const context = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;
