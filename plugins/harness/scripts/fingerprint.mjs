// What a session starts with, gathered once at SessionStart: the Claude Code version, the plugin release and where
// it runs from, the settings in force against the repo's, the newest release, and the other plugins loaded.
// Every probe is capped so the hook stays inside its 5 s budget (ledger L-hook-time-budget), and every failure
// becomes a null or an 'unknown', never a throw.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { release, repoDir } from './host.mjs';

export const DEPTH_ENV = 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH';
export const TAG_PREFIX = 'harness-v';

const run = (cmd, args, ms) => new Promise((ok) => {
  execFile(cmd, args, { timeout: ms, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    (err, out) => ok(err ? null : out));
});

const readJson = (path) => {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: error.code === 'ENOENT' ? 'missing' : `unreadable (${error.message})` };
  }
};

/** The `x.y.z` of `claude --version`, or null. */
export async function claudeVersion(ms = 1000) {
  const out = await run('claude', ['--version'], ms);
  return out?.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

/**
 * The newest release on the repo's origin, a tag harness-v<x.y.z> or a branch release/harness-v<x.y.z>:
 * { state: 'found', tag, version } (tag is the release's name), { state: 'none' } when origin has no release, or
 * { state: 'unknown' } when origin can't be asked within `ms`.
 */
export async function latestRelease(repo, ms = 2000) {
  const out = await Promise.race([
    run('git', ['-C', repo, 'ls-remote', 'origin', `refs/tags/${TAG_PREFIX}*`, `refs/heads/release/${TAG_PREFIX}*`], ms),
    new Promise((ok) => setTimeout(ok, ms + 100, null).unref())
  ]);
  if (out === null) return { state: 'unknown' };
  // Each version's commit: a branch's sha, or a tag's peeled (^{}) sha, which ls-remote lists after the tag's own.
  const commits = new Map();
  for (const m of out.matchAll(new RegExp(`^([0-9a-f]{40})\\trefs/(?:tags|heads/release)/${TAG_PREFIX}(\\d+\\.\\d+\\.\\d+)(\\^\\{\\})?$`, 'gm'))) {
    if (m[3] || !commits.has(m[2])) commits.set(m[2], m[1]);
  }
  if (!commits.size) return { state: 'none' };
  const newest = [...commits.keys()].sort(byVersion).at(-1);
  return { state: 'found', tag: `${TAG_PREFIX}${newest}`, version: newest, commit: commits.get(newest) };
}

/**
 * Whether commit `mine` already contains commit `release` (git merge-base --is-ancestor in `repo`): true, false, or
 * null when either is unknown or git can't tell in time. An install of a commit that is not itself a release (a PR's
 * merge commit, say) carries the manifest's version, which can be below a release it already contains.
 */
export async function contains(repo, mine, release, ms = 1000) {
  if (!mine || !release) return null;
  return new Promise((ok) => {
    execFile('git', ['-C', repo, 'merge-base', '--is-ancestor', release, mine], { timeout: ms, stdio: 'ignore' },
      (err) => ok(!err ? true : err.code === 1 ? false : null));
  });
}

export function byVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The allow rules a settings object holds. */
export const allowRules = (settings) => (Array.isArray(settings?.autoMode?.allow) ? settings.autoMode.allow : []);

/** A short hash of a rule list, independent of order, so two sessions can be compared at a glance. */
export const rulesHash = (rules) =>
  createHash('sha256').update(JSON.stringify(rules.toSorted())).digest('hex').slice(0, 16);

/** The plugins other than the account's synced ones, read from ~/.claude/skills (local disk, one level). */
export function skillsDirPlugins(home) {
  const dir = join(home, '.claude', 'skills');
  const found = [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of names.toSorted()) {
    const manifest = readJson(join(dir, name, '.claude-plugin', 'plugin.json')).value;
    if (manifest) found.push({ name: manifest.name ?? name, version: manifest.version ?? null, from: 'skills-dir' });
  }
  return found;
}

/** Whether `child` is `parent` or inside it, by real paths. */
function inside(child, parent) {
  try {
    const c = realpathSync(child), p = realpathSync(parent);
    return c === p || c.startsWith(`${p}/`);
  } catch {
    return false;
  }
}

// A file reference the plugin's code makes to another of its files: a relative static or dynamic import, or a
// new URL(..., import.meta.url).
const CODE_REF = /(?:\bfrom\s*|\bimport\s*\(\s*|\bnew URL\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;

/**
 * The files the plugin needs and which of them are missing: { checked, missing: [{ file, by }] }, paths relative to
 * `root`. It starts from what Claude Code reads (plugin.json, hooks.json and each command in it, each skill and the
 * scripts it names), plus the bundled journal in an installed copy, and follows every relative import from there.
 * A file deleted from the plugin, or lost from an installed copy, is named here (plan item clean-room-install-test).
 */
export function neededFiles(root, installed = false) {
  const missing = [], seen = new Set();
  const read = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
  const need = (path, by) => {
    const file = relative(root, path);
    if (seen.has(file)) return;
    seen.add(file);
    if (!existsSync(path)) return missing.push({ file, by });
    if (/\.(mjs|js)$/.test(path)) for (const m of read(path).matchAll(CODE_REF)) need(resolve(dirname(path), m[2]), file);
  };
  need(join(root, '.claude-plugin', 'plugin.json'), 'Claude Code');
  const hooks = join(root, 'hooks', 'hooks.json');
  need(hooks, 'Claude Code');
  for (const m of read(hooks).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s\\]+)/g)) need(join(root, m[1]), 'hooks/hooks.json');
  let skills = [];
  try {
    skills = readdirSync(join(root, 'skills')).toSorted();
  } catch {}
  for (const name of skills) {
    const skill = join(root, 'skills', name, 'SKILL.md');
    need(skill, 'Claude Code');
    for (const m of read(skill).matchAll(/<this skill's base directory>\/([^"\s`]+)/g)) need(resolve(dirname(skill), m[1]), relative(root, skill));
  }
  if (installed) need(join(root, 'lib', 'journal', 'src', 'index.js'), 'scripts/host.mjs');
  return { checked: seen.size, missing };
}

/** Everything the fingerprint and the self-check need, from the hook's input and the machine. */
export async function collect({ input = {}, env = process.env, root, home = env.HOME || homedir() } = {}) {
  const plugin = release(root);
  const repo = repoDir(env);
  const [claude, latest] = await Promise.all([claudeVersion(), latestRelease(repo)]);
  if (latest.state === 'found') latest.contained = await contains(repo, plugin.commit, latest.commit);
  const user = readJson(join(home, '.claude', 'settings.json'));
  const repoSettings = readJson(join(repo, '.claude', 'settings.json'));
  let link = false;
  try {
    link = lstatSync(plugin.root).isSymbolicLink();
  } catch {}
  return {
    claude,
    model: input.model ?? null,
    start: input.source ?? null,
    cwd: input.cwd ?? process.cwd(),
    home,
    repo,
    plugin,
    files: neededFiles(plugin.root, plugin.installed),
    pluginIsLink: link,
    pluginInRepo: inside(plugin.root, repo),
    latest,
    user,
    repoSettings,
    plugins: skillsDirPlugins(home),
    environment: {
      remote: env.CLAUDE_CODE_REMOTE ?? null,
      entrypoint: env.CLAUDE_CODE_ENTRYPOINT ?? null,
      container: env.CLAUDE_CODE_CONTAINER_ID ?? null
    }
  };
}

/** The session.fingerprint payload (docs/journal.md). */
export function fingerprint(facts) {
  const rules = allowRules(facts.user.value);
  const { name, version, tag, commit, root } = facts.plugin;
  return {
    claude_code: facts.claude,
    model: facts.model,
    start: facts.start,
    cwd: facts.cwd,
    plugin: { name, version, tag, commit, root },
    latest_release: facts.latest.state === 'found' ? facts.latest.version : facts.latest.state,
    settings: facts.user.value ? 'present' : facts.user.error,
    allow_rules: rules.length,
    rules_hash: rulesHash(rules),
    depth: facts.user.value?.env?.[DEPTH_ENV] ?? null,
    plugins: facts.plugins,
    environment: facts.environment
  };
}
