// What every hook and script in this plugin shares: the per-project install gate, where the harness keeps its
// files, and which release this code is. The marker path and the switches live here and nowhere else.
//
// The setup script installs this plugin for every project that uses the environment, so each hook first asks
// gate() and does nothing (exit 0, no output, no writes) unless the project installed the harness.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The harness's folder in the project's shared files; tests point it elsewhere. */
export const harnessDir = (env = process.env) => env.CCP_HARNESS_DIR || '/mnt/project-files/harness';
/** The install marker. Its presence is what "installed in this project" means. */
export const markerPath = (env = process.env) => join(harnessDir(env), 'install.json');
/** The journal root the install creates. Each session appends to its own file under sessions/. */
export const journalDir = (env = process.env) => join(harnessDir(env), 'journal');
/** Set to 1 to turn every hook off, even where the marker exists. */
export const DISABLE_ENV = 'CCP_HARNESS_DISABLED';
/** The repo clone the setup script ran from, which holds the settings the session should have. */
export const repoDir = (env = process.env) => env.CCP_REPO || '/home/user/ccp_xstate';

/** The plugin folder this code runs from: an installed copy, or plugins/harness in the repo. */
export const pluginRoot = () => dirname(dirname(fileURLToPath(import.meta.url)));

const later = (ms, value) => new Promise((ok) => setTimeout(ok, ms, value).unref());

/**
 * 'disabled' when CCP_HARNESS_DISABLED=1, 'installed' when the marker can be read, else 'absent'.
 * One read and no folder listing, capped at `ms` because the project files mount is slow when cold.
 */
export async function gate(env = process.env, ms = 1000) {
  if (env[DISABLE_ENV] === '1') return 'disabled';
  const read = readFile(markerPath(env)).then(() => 'installed', () => 'absent');
  return Promise.race([read, later(ms, 'absent')]);
}

/**
 * { name, version, tag, commit, root, installed }: name and version from plugin.json; tag and commit from the
 * release.json the setup script writes into an installed copy (both null when running from the repo).
 */
export function release(root = pluginRoot()) {
  let name = 'ccp-harness', version = '0.0.0';
  try {
    ({ name = name, version = version } = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')));
  } catch {}
  let tag = null, commit = null, installed = false;
  try {
    ({ tag = null, commit = null } = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8')));
    installed = true;
  } catch {}
  return { name, version, tag, commit, root, installed };
}

/**
 * The journal library. The setup script bundles packages/journal into an installed copy at lib/journal; in the
 * repo it is read from packages/journal.
 */
export async function journal(root = pluginRoot()) {
  const bundled = join(root, 'lib', 'journal', 'src', 'index.js');
  const path = existsSync(bundled) ? bundled : join(root, '..', '..', 'packages', 'journal', 'src', 'index.js');
  return import(path);
}

/**
 * The session as Claude-Session names it: the cloud session's URL, else the local session id. The environment
 * names a cloud session cse_<id> where its URL says session_<id> (seen 2026-10-30), so the prefix is swapped.
 */
export function sessionName(input = {}, env = process.env) {
  const remote = env.CLAUDE_CODE_REMOTE_SESSION_ID;
  if (remote) return `https://claude.ai/code/${remote.replace(/^cse_/, 'session_')}`;
  return input.session_id || 'unknown-session';
}

/** The session's journal file name: its id reduced to safe characters. */
export const sessionFile = (session) => `${String(session).replace(/^https:\/\/claude\.ai\/code\//, '').replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`;

// The hook's input, or '' when it is not all there within `ms` (a hook must not wait on its stdin).
export function stdin(ms) {
  return new Promise((ok) => {
    let text = '';
    setTimeout(() => ok(text), ms).unref();
    process.stdin.setEncoding('utf8').on('data', (d) => (text += d)).on('end', () => ok(text)).on('error', () => ok(''));
  });
}

/**
 * The engine library (packages/engine/src), for the actor hooks: bundled at lib/engine in an installed copy when the
 * setup script bundles it, else packages/engine beside the plugin in the repo, else the repo clone's.
 */
export async function engine(file, root = pluginRoot(), env = process.env) {
  const places = [join(root, 'lib', 'engine', 'src'), join(root, '..', '..', 'packages', 'engine', 'src'), join(repoDir(env), 'packages', 'engine', 'src')];
  const dir = places.find((p) => existsSync(join(p, file)));
  if (!dir) throw new Error(`no engine library at ${places.join(', ')}`);
  return import(join(dir, file));
}
