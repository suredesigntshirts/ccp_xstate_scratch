// Verifier's own tests for plan item self-update-by-version, Expect line no-self-edit: nothing in the update path
// (the notice hook and setup.sh, which does the install and the clone fast-forward) writes under the plugin root a
// running Claude Code uses. Method: strace -f every write-like syscall of the real scripts and look at the paths,
// not at what the scripts say about themselves. A control run (no running Claude) proves the detector sees writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasStrace = spawnSync('strace', ['-V']).status === 0;
const tmp = (n) => realpathSync(mkdtempSync(join(tmpdir(), `verify-noself-${n}-`)));
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=v@v', '-c', 'user.name=v', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// path -> sha256 (or LINK) for every entry under dir, plus directory listing, so any create/modify/delete shows.
function snap(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n), s = lstatSync(p);
      if (s.isSymbolicLink()) out[p] = 'LINK';
      else if (s.isDirectory()) { out[p] = 'DIR'; walk(p); }
      else out[p] = createHash('sha256').update(readFileSync(p)).digest('hex') + ':' + s.mtimeMs;
    }
  };
  walk(dir);
  return out;
}

const WRITEY = /^(?:\d+\s+)?(openat|open|creat|mkdir|mkdirat|rename|renameat|renameat2|unlink|unlinkat|rmdir|symlink|symlinkat|link|linkat|truncate|chmod|fchmodat|utimensat|setxattr)\(/;
/** Paths a traced process wrote to (by write-like syscall) that start with any of `roots`. */
function writesUnder(traceFile, roots) {
  const hits = [];
  for (const line of readFileSync(traceFile, 'utf8').split('\n')) {
    const m = line.match(WRITEY);
    if (!m) continue;
    if (/ = -1 E/.test(line)) continue; // failed calls wrote nothing
    if ((m[1] === 'openat' || m[1] === 'open') && !/O_WRONLY|O_RDWR|O_CREAT|O_TRUNC/.test(line)) continue;
    const paths = [...line.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (paths.some((p) => roots.some((r) => p === r || p.startsWith(r + '/')))) hits.push(line.trim());
  }
  return hits;
}
function traced(trace, cmd, args, env) {
  const r = spawnSync('strace', ['-f', '-qq', '-s', '300', '-o', trace, '-e', 'trace=file,desc,process', cmd, ...args], { env, encoding: 'utf8', timeout: 60000 });
  return r;
}

// An origin with release tags, and a clone of it (which holds setup.sh) tracking origin/main.
function world() {
  const t = tmp('world');
  const origin = join(t, 'origin.git'), clone = join(t, 'clone'), home = join(t, 'home');
  execFileSync('git', ['clone', '-q', '--bare', REPO, origin]);
  // A clone of this repo carries whatever releases it has seen (a thread's clone has harness-v0.1.0 since 16:45Z,
  // CI's shallow checkout has none), so drop them: the world's releases are only the ones each test makes.
  for (const ref of git(origin, 'for-each-ref', '--format=%(refname)', 'refs/tags/harness-v*', 'refs/heads/release/').split('\n').filter(Boolean)) {
    git(origin, 'update-ref', '-d', ref);
  }
  git(origin, 'branch', '-f', 'main', 'HEAD');
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(origin, 'tag', 'harness-v0.0.5', 'main');
  execFileSync('git', ['clone', '-q', origin, clone]);
  mkdirSync(home);
  return { t, origin, clone, home, setup: join(clone, 'infra', 'cloud-environment', 'setup.sh'), dest: join(home, '.claude', 'skills', 'ccp-harness') };
}
const runSetup = (w, extra = {}) => ({ HOME: w.home, PATH: process.env.PATH, CCP_SETUP_LOG: join(w.t, 'setup.log'), ...extra });
const manifestVersion = (dest) => JSON.parse(readFileSync(join(dest, '.claude-plugin', 'plugin.json'), 'utf8')).version;

test('no-self-edit: setup.sh run beside a live Claude Code in the same HOME writes nothing under the plugin root', { skip: !hasStrace && 'strace missing' }, async () => {
  const w = world();
  // First container build: no Claude running, installs 0.0.5.
  assert.equal(spawnSync('bash', [w.setup], { env: runSetup(w) }).status, 0);
  assert.equal(manifestVersion(w.dest), '0.0.5');
  // A newer release and a newer main appear on origin.
  const other = join(w.t, 'other');
  execFileSync('git', ['clone', '-q', w.origin, other]);
  git(other, 'commit', '-q', '--allow-empty', '-m', 'advance');
  git(other, 'push', '-q', 'origin', 'HEAD:main');
  git(w.origin, 'tag', 'harness-v9.0.0', 'main');

  const before = snap(w.dest);
  const claude = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { HOME: w.home, PATH: process.env.PATH } });
  try {
    const trace = join(w.t, 'running.trace');
    traced(trace, 'bash', [w.setup], runSetup(w, { CLAUDE_PID: String(claude.pid) }));
    const log = readFileSync(join(w.t, 'setup.log'), 'utf8');
    assert.match(log, /plugin not replaced: Claude Code \(pid \d+\) is running from this HOME/);
    assert.match(log, /clone fast-forwarded/, 'the update path still ran (the clone moved), so the trace is not vacuous');
    assert.notEqual(git(w.clone, 'rev-parse', 'HEAD'), git(other, 'rev-parse', 'HEAD~1'));
    const roots = [w.dest, w.dest + '.old', join(w.home, '.claude', 'skills', 'ccp-harness')];
    assert.deepEqual(writesUnder(trace, roots), [], 'no write-like syscall touches the plugin root or its .old');
    assert.deepEqual(snap(w.dest), before, 'plugin root byte-for-byte and mtime unchanged');
    assert.equal(manifestVersion(w.dest), '0.0.5');
    assert.ok(!existsSync(w.dest + '.old'));
    // It still wrote elsewhere under HOME (settings), so the detector is looking at a real writer.
    assert.ok(writesUnder(trace, [join(w.home, '.claude')]).length > 0);

    // Control: with no running Claude the same script does replace the plugin, and the detector sees it.
    const control = join(w.t, 'control.trace');
    traced(control, 'bash', [w.setup], runSetup(w));
    assert.ok(writesUnder(control, [w.dest]).length > 0, 'detector sees the install when nothing is running');
    assert.equal(manifestVersion(w.dest), '9.0.0');
  } finally {
    claude.kill();
  }
});

test('no-self-edit: a Claude running from a different HOME does not block the install (the guard is not a blanket skip)', () => {
  const w = world();
  assert.equal(spawnSync('bash', [w.setup], { env: runSetup(w) }).status, 0);
  git(w.origin, 'tag', 'harness-v1.2.3', 'main');
  const elsewhere = tmp('otherhome');
  const claude = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { HOME: elsewhere, PATH: process.env.PATH } });
  try {
    spawnSync('bash', [w.setup], { env: runSetup(w, { CLAUDE_PID: String(claude.pid) }) });
    assert.equal(manifestVersion(w.dest), '1.2.3');
  } finally {
    claude.kill();
  }
});

test('no-self-edit: the notice hook, run from the installed copy while behind, writes nothing under the plugin root', { skip: !hasStrace && 'strace missing' }, () => {
  const w = world();
  assert.equal(spawnSync('bash', [w.setup], { env: runSetup(w) }).status, 0); // installs 0.0.5
  git(w.origin, 'tag', 'harness-v0.0.9', 'main');
  const dir = tmp('project'), state = tmp('state');
  execFileSync(process.execPath, [join(w.dest, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, HOME: w.home, CCP_HARNESS_DIR: dir } });
  const before = snap(w.dest);
  const trace = join(w.t, 'hook.trace');
  const env = { PATH: process.env.PATH, HOME: w.home, CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: state, CCP_REPO: w.clone, CLAUDE_PLUGIN_ROOT: w.dest };
  const r = spawnSync('strace', ['-f', '-qq', '-s', '300', '-o', trace, '-e', 'trace=file,desc,process', process.execPath, join(w.dest, 'scripts', 'notice-behind.mjs')],
    { env, input: JSON.stringify({ session_id: 'v1', hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0\.0\.9/, 'the hook did tell the session it is behind, so the whole path ran');
  assert.deepEqual(writesUnder(trace, [w.dest]), []);
  assert.deepEqual(snap(w.dest), before);
  assert.ok(readdirSync(state).length > 0, 'its one write is its timestamp, outside the plugin root');
  assert.ok(writesUnder(trace, [state]).length > 0);
});

test('no-self-edit: release.mjs only writes git objects and refs in the repo it is run in, never the plugin', { skip: !hasStrace && 'strace missing' }, () => {
  const w = world();
  const trace = join(w.t, 'release.trace');
  // A commit that changes the plugin on a throwaway clone, then tag it with the real script.
  const c = join(w.t, 'rel');
  execFileSync('git', ['clone', '-q', w.origin, c]);
  writeFileSync(join(c, 'plugins', 'harness', 'NEW.txt'), 'x');
  git(c, 'add', '-A');
  git(c, 'commit', '-q', '-m', 'plugin change');
  const r = spawnSync('strace', ['-f', '-qq', '-s', '300', '-o', trace, '-e', 'trace=file,desc,process', process.execPath, join(c, 'scripts', 'release', 'release.mjs'), 'tag'], { cwd: c, env: { PATH: process.env.PATH, HOME: w.home, GITHUB_SHA: git(c, 'rev-parse', 'HEAD') }, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(git(c, 'tag', '-l', 'harness-v*', '--sort=-v:refname'), /harness-v0\.1\.0/);
  const wrote = writesUnder(trace, [c]).filter((l) => !/\/\.git\//.test(l));
  assert.deepEqual(wrote, [], 'outside .git, nothing in the working tree is written');
  assert.deepEqual(writesUnder(trace, [join(w.home, '.claude')]), []);
});

// Added at 278e45d: a release is now a branch release/harness-v<x.y.z> (the proxy drops tag pushes), so the same
// guarantees are re-proved for the branch path.
test('no-self-edit: release.mjs branch --push writes only git refs, and pushes release/harness-v<x.y.z> to origin', { skip: !hasStrace && 'strace missing' }, () => {
  const w = world();
  const trace = join(w.t, 'branch.trace');
  const c = join(w.t, 'rel');
  execFileSync('git', ['clone', '-q', w.origin, c]);
  writeFileSync(join(c, 'plugins', 'harness', 'NEW.txt'), 'x');
  git(c, 'add', '-A');
  git(c, 'commit', '-q', '-m', 'plugin change');
  git(c, 'push', '-q', 'origin', 'HEAD:main');
  const sha = git(c, 'rev-parse', 'HEAD');
  const r = spawnSync('strace', ['-f', '-qq', '-s', '300', '-o', trace, '-e', 'trace=file,desc,process', process.execPath, join(c, 'scripts', 'release', 'release.mjs'), 'branch', '--push'], { cwd: c, env: { PATH: process.env.PATH, HOME: w.home, RELEASE_SHA: sha }, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(w.origin, 'rev-parse', 'refs/heads/release/harness-v0.1.0'), sha, 'branch pushed at the sha (manifest 0.1.0 > tag 0.0.5 + 1)');
  assert.deepEqual(writesUnder(trace, [c]).filter((l) => !/\/\.git\//.test(l)), [], 'outside .git, nothing is written');
  assert.deepEqual(writesUnder(trace, [join(w.home, '.claude')]), []);
});

test('no-self-edit: setup.sh beside a live Claude, with the newest release only a branch, leaves the plugin untouched; without Claude it installs that branch', { skip: !hasStrace && 'strace missing' }, () => {
  const w = world();
  assert.equal(spawnSync('bash', [w.setup], { env: runSetup(w) }).status, 0);
  assert.equal(manifestVersion(w.dest), '0.0.5');
  git(w.origin, 'branch', 'release/harness-v9.1.0', 'main');
  const before = snap(w.dest);
  const claude = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { HOME: w.home, PATH: process.env.PATH } });
  try {
    const trace = join(w.t, 'br-running.trace');
    traced(trace, 'bash', [w.setup], runSetup(w, { CLAUDE_PID: String(claude.pid) }));
    assert.match(readFileSync(join(w.t, 'setup.log'), 'utf8'), /plugin not replaced: Claude Code/);
    assert.deepEqual(writesUnder(trace, [w.dest, w.dest + '.old']), []);
    assert.deepEqual(snap(w.dest), before);
    assert.equal(manifestVersion(w.dest), '0.0.5');
    const control = join(w.t, 'br-control.trace');
    traced(control, 'bash', [w.setup], runSetup(w));
    assert.ok(writesUnder(control, [w.dest]).length > 0);
    assert.equal(manifestVersion(w.dest), '9.1.0', 'a release branch is picked up as the newest release');
  } finally {
    claude.kill();
  }
});
