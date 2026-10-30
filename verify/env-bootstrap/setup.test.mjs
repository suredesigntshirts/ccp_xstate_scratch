// Verifier's own tests for plan item env-bootstrap: clean-home, copy-not-link, and inert (hook silence).
// setup.sh installs the committed HEAD (CCP_SETUP_REF=HEAD, no fetch), so these test the code they sit beside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETUP = join(REPO, 'infra', 'cloud-environment', 'setup.sh');
const tmp = (n) => mkdtempSync(join(tmpdir(), `verify-envboot-${n}-`));

function runSetup(home, log) {
  execFileSync('bash', [SETUP], { env: { ...process.env, HOME: home, CCP_SETUP_LOG: log, CCP_SETUP_FETCH: '0', CCP_SETUP_REF: 'HEAD' } });
}
// path -> content for every file (and symlink target) under dir
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const s = lstatSync(p);
      if (s.isSymbolicLink()) out[p.slice(dir.length)] = 'LINK';
      else if (s.isDirectory()) walk(p);
      else out[p.slice(dir.length)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

test('clean-home: two setup runs in an empty HOME leave identical ~/.claude trees', () => {
  const t = tmp('clean');
  const home = join(t, 'home');
  mkdirSync(home);
  runSetup(home, join(t, 'log1'));
  const first = tree(join(home, '.claude'));
  runSetup(home, join(t, 'log2'));
  const second = tree(join(home, '.claude'));
  assert.ok(Object.keys(first).length >= 10, 'something was installed');
  assert.ok(first['/settings.json'] && first['/skills/ccp-harness/release.json']);
  assert.deepEqual(second, first);
  assert.ok(!existsSync(join(home, '.claude', 'skills', 'ccp-harness.old')));
  // and a second, independent empty HOME gives the same files too
  const home2 = join(t, 'home2');
  mkdirSync(home2);
  runSetup(home2, join(t, 'log3'));
  assert.deepEqual(tree(join(home2, '.claude')), first);
});

test('copy-not-link: no symlinks, and working-tree edits do not reach the installed copy', () => {
  const t = tmp('copy');
  const home = join(t, 'home');
  mkdirSync(home);
  runSetup(home, join(t, 'log'));
  const installed = join(home, '.claude', 'skills', 'ccp-harness');
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  const before = tree(installed);
  assert.ok(!Object.values(before).includes('LINK'));
  // Edit a copy of a plugin file standing in for the working tree is not enough: edit the real one and restore it.
  const target = join(REPO, 'plugins', 'harness', 'scripts', 'host.mjs');
  const original = readFileSync(target, 'utf8');
  const extra = join(REPO, 'plugins', 'harness', 'VERIFY-EXTRA.txt');
  try {
    writeFileSync(target, `${original}\n// verifier edit ${Date.now()}\n`);
    writeFileSync(extra, 'new');
    assert.deepEqual(tree(installed), before);
    assert.ok(!existsSync(join(installed, 'VERIFY-EXTRA.txt')));
  } finally {
    writeFileSync(target, original);
    spawnSync('rm', ['-f', extra]);
  }
});

test('inert: the SessionStart hook is silent and writes nothing without an install marker', () => {
  const t = tmp('inert');
  const home = join(t, 'home');
  mkdirSync(home);
  runSetup(home, join(t, 'log'));
  const hooks = JSON.parse(readFileSync(join(home, '.claude', 'skills', 'ccp-harness', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const scripts = Object.values(hooks).flat().flatMap((g) => g.hooks).map((h) => h.command.match(/scripts\/[\w.-]+/)[0]);
  assert.ok(scripts.length >= 1);
  for (const s of scripts) {
    const dir = mkdtempSync(join(t, 'empty-'));
    const proj = mkdtempSync(join(t, 'proj-'));
    const r = spawnSync(process.execPath, [join(home, '.claude', 'skills', 'ccp-harness', s)], {
      input: JSON.stringify({ session_id: 's', cwd: proj, hook_event_name: 'SessionStart', source: 'startup' }),
      encoding: 'utf8', cwd: proj, env: { PATH: process.env.PATH, HOME: home, CCP_HARNESS_DIR: dir }
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.deepEqual(readdirSync(dir), []);
    assert.deepEqual(readdirSync(proj), []);
  }
});
