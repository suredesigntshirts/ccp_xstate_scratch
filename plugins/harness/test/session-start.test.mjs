// The SessionStart hook, run as Claude Code runs it: a node process with the hook input on stdin.
// Expect lines inert and rows (plan item env-bootstrap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN, REPO, RULES, TEST_REF, context, fakeRepo, runHook, setup, snapshot, temp, writeSettings } from './helpers.mjs';
import { readFile } from '../../../packages/journal/src/index.js';

const INPUT = { session_id: 'test-session-1', cwd: '/tmp', hook_event_name: 'SessionStart', source: 'startup' };
const REPO_HOOK = join(PLUGIN, 'scripts', 'session-start.mjs');

// One temp HOME with the plugin installed by the real setup script, shared by the tests below.
const home = join(temp('home'), 'home');
mkdirSync(home);
setup(home);
const INSTALLED = join(home, '.claude', 'skills', 'ccp-harness');
const INSTALLED_HOOK = join(INSTALLED, 'scripts', 'session-start.mjs');
const settings = () => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));

// A copy of the installed plugin without the file `gone`, for the files check (plan item clean-room-install-test).
function brokenCopy(gone) {
  const root = join(temp('broken'), 'ccp-harness');
  cpSync(INSTALLED, root, { recursive: true });
  rmSync(join(root, gone));
  return join(root, 'scripts', 'session-start.mjs');
}

// An installed project: a harness folder with the marker and the journal root, made by the real install script.
function project() {
  const dir = temp('project');
  const out = execFileSync(process.execPath, [join(INSTALLED, 'scripts', 'install.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, CCP_HARNESS_DIR: dir } });
  assert.match(out, /installed in this project/);
  return dir;
}

function rows(dir) {
  const files = readdirSync(join(dir, 'journal', 'sessions'));
  assert.deepEqual(files, ['test-session-1.jsonl']);
  const { rows, bad } = readFile(join(dir, 'journal', 'sessions', files[0]));
  assert.deepEqual(bad, []);
  return rows;
}

function failed(row) {
  return row.payload.checks.filter((c) => c.status === 'fail').map((c) => c.id);
}

test('inert: with no install marker the hook exits 0, prints nothing and writes nothing', () => {
  const dir = temp('nomarker');
  const before = { ...snapshot(dir), ...snapshot(home) };
  for (const hook of [INSTALLED_HOOK, REPO_HOOK]) {
    const r = runHook(hook, { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_REPO: fakeRepo() }, input: INPUT });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
  }
  assert.deepEqual({ ...snapshot(dir), ...snapshot(home) }, before);
});

test('inert: CCP_HARNESS_DISABLED=1 silences an installed project too', () => {
  const dir = project();
  const before = snapshot(dir);
  const r = runHook(INSTALLED_HOOK, { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_HARNESS_DISABLED: '1' }, input: INPUT });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.deepEqual(snapshot(dir), before);
});

test('rows: an installed session writes one fingerprint and one passing self-check', () => {
  const dir = project();
  const r = runHook(INSTALLED_HOOK, { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_REPO: fakeRepo({ tags: ['0.1.0'] }) }, input: INPUT });
  assert.equal(r.status, 0);
  assert.match(context(r.stdout), /^ccp-harness 0\.1\.0: self-check passed \(7 of 7 checks\)\.$/);
  const [fp, sc] = rows(dir);
  assert.equal(fp.kind, 'session.fingerprint');
  assert.equal(fp.session, 'test-session-1');
  assert.equal(fp.release, '0.1.0');
  assert.equal(fp.payload.plugin.version, '0.1.0');
  assert.equal(fp.payload.plugin.root, INSTALLED);
  assert.equal(fp.payload.latest_release, '0.1.0');
  assert.equal(fp.payload.allow_rules, settings().autoMode.allow.length);
  assert.equal(fp.payload.depth, '3');
  assert.equal(fp.payload.start, 'startup');
  assert.equal(sc.kind, 'session.selfcheck');
  assert.equal(sc.payload.passed, true);
  assert.deepEqual(sc.payload.checks.map((c) => [c.id, c.status]),
    [['settings', 'pass'], ['rules', 'pass'], ['depth', 'pass'], ['files', 'pass'], ['copy', 'pass'], ['release', 'pass'], ['journal', 'pass']]);
});

// Each case breaks one thing and expects exactly that check to fail, named in one sentence in the session's line.
// A copy of the installed plugin that says it is the release harness-v0.1.0, as setup.sh writes a release install.
function taggedCopy() {
  const root = join(temp('tagged'), 'ccp-harness');
  cpSync(INSTALLED, root, { recursive: true });
  const path = join(root, 'release.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), tag: 'harness-v0.1.0' }));
  return join(root, 'scripts', 'session-start.mjs');
}

const ONE_FAILING = [
  {
    id: 'depth',
    setHome: (h) => writeSettings(h, { ...settings(), env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1' } }),
    says: /Subagent depth is 1, not 3, so subagents can't start their own subagents\./
  },
  {
    id: 'rules',
    setHome: (h) => writeSettings(h, { ...settings(), autoMode: { allow: settings().autoMode.allow.slice(0, 2) } }),
    says: new RegExp(`${RULES.length - 2} of the repo's ${RULES.length} allow rules are not in ~/\\.claude/settings\\.json`)
  },
  {
    id: 'copy',
    hook: REPO_HOOK,
    says: /The plugin runs from .*plugins\/harness, which is not an installed release copy/
  },
  {
    id: 'files',
    hook: brokenCopy('scripts/notice-behind.mjs'),
    says: /The plugin at .* is missing scripts\/notice-behind\.mjs \(needed by hooks\/hooks\.json\)/
  },
  {
    id: 'release',
    hook: taggedCopy(),
    tags: ['0.1.0', '0.2.0'],
    says: /This session runs release 0\.1\.0 but 0\.2\.0 is out/
  }
];

for (const c of ONE_FAILING) {
  test(`rows: a failing ${c.id} check is the only failure, named in one plain sentence`, () => {
    const dir = project();
    const h = join(temp('home'), 'home');
    mkdirSync(h);
    writeSettings(h, settings());
    c.setHome?.(h);
    const r = runHook(c.hook ?? INSTALLED_HOOK, { env: { HOME: h, CCP_HARNESS_DIR: dir, CCP_REPO: fakeRepo({ tags: c.tags ?? ['0.1.0'] }) }, input: INPUT });
    assert.equal(r.status, 0);
    const line = context(r.stdout);
    assert.match(line, /self-check FAILED\. /);
    assert.match(line, c.says);
    assert.equal(line.split('FAILED. ')[1].split(/(?<=\.) (?=[A-Z~])/).length, 1, `one sentence: ${line}`);
    const [fp, sc] = rows(dir);
    assert.equal(fp.kind, 'session.fingerprint');
    assert.equal(sc.payload.passed, false);
    assert.deepEqual(failed(sc), [c.id]);
  });
}

test('files: a copy missing a module the hook itself imports still names it, exits 0 and journals nothing', () => {
  for (const gone of ['scripts/fingerprint.mjs', 'scripts/host.mjs', 'scripts/selfcheck.mjs']) {
    const dir = project();
    const r = runHook(brokenCopy(gone), { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_REPO: fakeRepo({ tags: ['0.1.0'] }) }, input: INPUT });
    assert.equal(r.status, 0);
    assert.match(context(r.stdout), new RegExp(`^ccp-harness: self-check FAILED\\. The plugin at .* is missing ${gone.replace('.', '\\.')}, so the session-start self-check could not run`));
    assert.equal(existsSync(join(dir, 'journal', 'sessions', 'test-session-1.jsonl')), false);
  }
});

test('files: the repo plugin needs its hooks, skill and journal files, and none is missing', async () => {
  const { neededFiles } = await import('../scripts/fingerprint.mjs');
  const { checked, missing } = neededFiles(PLUGIN);
  assert.deepEqual(missing, []);
  const installed = neededFiles(INSTALLED, true);
  assert.deepEqual(installed.missing, []);
  assert.ok(checked >= 8 && installed.checked > checked, `checked ${checked}, installed ${installed.checked}`);
});

test('files: a copy that lost a journal file fails files naming it, and the journal check says why the rows are lost', () => {
  const dir = project();
  const r = runHook(brokenCopy('lib/journal/src/kinds.js'), { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_REPO: fakeRepo({ tags: ['0.1.0'] }) }, input: INPUT });
  assert.equal(r.status, 0);
  const line = context(r.stdout);
  assert.match(line, /is missing lib\/journal\/src\/kinds\.js \(needed by lib\/journal\/src\/index\.js\)/);
  assert.match(line, /The journal at .* could not be written/);
});

test('rows: no settings file fails the settings check and says the setup script did not run', () => {
  const dir = project();
  const h = join(temp('home'), 'home');
  mkdirSync(h);
  const r = runHook(INSTALLED_HOOK, { env: { HOME: h, CCP_HARNESS_DIR: dir, CCP_REPO: fakeRepo({ tags: ['0.1.0'] }) }, input: INPUT });
  assert.match(context(r.stdout), /~\/\.claude\/settings\.json is missing, so the setup script did not run in this container/);
  const [, sc] = rows(dir);
  assert.ok(failed(sc).includes('settings'));
});

test('rows: a journal that cannot be written is named in the session line, and the hook still exits 0', () => {
  const dir = temp('nojournal');
  writeFileSync(join(dir, 'install.json'), '{}');
  const r = runHook(INSTALLED_HOOK, { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_REPO: fakeRepo({ tags: ['0.1.0'] }) }, input: INPUT });
  assert.equal(r.status, 0);
  assert.match(context(r.stdout), /self-check FAILED\. The journal at .* could not be written/);
});

test('rows: an unreachable origin leaves the release unchecked, not failed', () => {
  const dir = project();
  const repo = fakeRepo();
  execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', join(repo, 'nowhere.git')]);
  const r = runHook(INSTALLED_HOOK, { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_REPO: repo }, input: INPUT });
  assert.match(context(r.stdout), /self-check passed \(6 of 7 checks\)\. Not checked: The newest release could not be read/);
  const [, sc] = rows(dir);
  assert.equal(sc.payload.checks.find((c) => c.id === 'release').status, 'unknown');
});

test('release: an install whose commit already contains the newest release passes, though its version is lower', () => {
  // A repo sharing this clone's objects, whose origin's newest release (9.9.9) is the installed commit itself.
  const dir = temp('contains');
  const origin = join(dir, 'origin.git'), repo = join(dir, 'clone');
  const rev = (r) => execFileSync('git', ['-C', REPO, 'rev-parse', r], { encoding: 'utf8' }).trim();
  const objects = `${execFileSync('git', ['-C', REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()}/objects\n`;
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(join(origin, 'objects', 'info', 'alternates'), objects);
  writeFileSync(join(repo, '.git', 'objects', 'info', 'alternates'), objects);
  execFileSync('git', ['-C', origin, 'update-ref', 'refs/heads/release/harness-v9.9.9', rev(TEST_REF)]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', origin]);
  const run = (r) => runHook(INSTALLED_HOOK, { env: { HOME: home, CCP_HARNESS_DIR: project(), CCP_REPO: repo }, input: INPUT });
  let r = run();
  assert.match(context(r.stdout), /self-check passed/);
  assert.doesNotMatch(context(r.stdout), /9\.9\.9 is out/);
  // The same release as an annotated tag.
  execFileSync('git', ['-C', origin, 'update-ref', '-d', 'refs/heads/release/harness-v9.9.9']);
  execFileSync('git', ['-C', origin, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'tag.gpgsign=false', 'tag', '-a', '-m', 'release', 'harness-v9.9.9', rev(TEST_REF)]);
  r = run();
  assert.match(context(r.stdout), /self-check passed/);
  execFileSync('git', ['-C', origin, 'tag', '-d', 'harness-v9.9.9']);
});

// contains() over a repo made here, so the answer doesn't depend on how much history the test checkout has.
test('release: contains() says true for an ancestor, false for a commit not in the history, null when it cannot tell', async () => {
  const { contains } = await import('../scripts/fingerprint.mjs');
  const repo = join(temp('history'), 'repo');
  execFileSync('git', ['init', '-q', repo]);
  const commit = (...parents) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', '-m', `c${parents.length}`,
    ...parents.flatMap((p) => ['-p', p]), '4b825dc642cb6eb9a060e54bf8d69288fbee4904'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repo, 'hash-object', '-w', '-t', 'tree', '/dev/null']);
  const a = commit(), b = commit(a), elsewhere = execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', '-m', 'elsewhere', '4b825dc642cb6eb9a060e54bf8d69288fbee4904'], { encoding: 'utf8' }).trim();
  assert.equal(await contains(repo, b, a), true);
  assert.equal(await contains(repo, b, b), true);
  assert.equal(await contains(repo, a, b), false);
  assert.equal(await contains(repo, b, elsewhere), false);
  assert.equal(await contains(repo, b, '0'.repeat(40)), null);
  assert.equal(await contains(repo, null, a), null);
});

test('release: an older install fails unless it is an untagged commit that contains the release, or git cannot tell', async () => {
  const { CHECKS } = await import('../scripts/selfcheck.mjs');
  const facts = (tag, contained) => ({ plugin: { version: '0.1.0', tag, commit: 'c'.repeat(40) }, latest: { state: 'found', tag: 'harness-v0.2.0', version: '0.2.0', contained } });
  assert.equal(CHECKS.release(facts(null, true)).status, 'pass');
  assert.equal(CHECKS.release(facts(null, null)).status, 'unknown');
  assert.equal(CHECKS.release(facts(null, false)).status, 'fail');
  for (const contained of [true, null, false]) assert.equal(CHECKS.release(facts('harness-v0.1.0', contained)).status, 'fail', `tagged, contained ${contained}`);
  assert.equal(CHECKS.release({ ...facts(null, null), plugin: { version: '0.2.0', tag: null } }).status, 'pass');
});

test('the install script makes the journal root and the marker once, and a second run changes nothing', () => {
  const dir = project();
  const marker = readFileSync(join(dir, 'install.json'), 'utf8');
  assert.equal(JSON.parse(marker).release.version, '0.1.0');
  const out = execFileSync(process.execPath, [join(INSTALLED, 'scripts', 'install.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, CCP_HARNESS_DIR: dir } });
  assert.match(out, /already installed/);
  assert.equal(readFileSync(join(dir, 'install.json'), 'utf8'), marker);
});

test('a cloud session is journalled under its Claude-Session URL', async () => {
  const { sessionName, sessionFile } = await import('../scripts/host.mjs');
  const name = sessionName({ session_id: 'local' }, { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01AbC' });
  assert.equal(name, 'https://claude.ai/code/session_01AbC');
  assert.equal(sessionFile(name), 'session_01AbC.jsonl');
  assert.equal(sessionName({ session_id: 'local' }, {}), 'local');
});
