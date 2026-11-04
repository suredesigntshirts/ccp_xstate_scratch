// Verifier tests for clean-room-install-test: the clean room starts empty, passes on this tree, and a deleted
// plugin file makes the self-check name it. Offline: the tree under test is exported from HEAD into a temp repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanRoom } from '../../scripts/clean-room/run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=v@v', '-c', 'user.name=v', '-c', 'commit.gpgsign=false', ...a], { cwd, stdio: 'pipe' });

function copyOfHead(drop = null) {
  const dir = mkdtempSync(join(tmpdir(), 'cr-verify-'));
  execFileSync('sh', ['-c', `git archive HEAD .claude infra plugins packages | tar -x -C "${dir}"`], { cwd: ROOT });
  if (drop) rmSync(join(dir, drop));
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'tree');
  return dir;
}
const run = (repo) => cleanRoom({ repo, ref: 'HEAD', session: 'hooks', env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'ignored-in-hooks-mode', CCP_HARNESS_DIR: '/nonexistent/leak' } });

test('clean room passes on the tree and starts with empty HOME and project', () => {
  const repo = copyOfHead();
  const r = run(repo);
  try {
    assert.equal(r.passed, true, JSON.stringify(r.steps));
    assert.match(r.steps[0].detail, /start empty/);
    assert.ok(r.steps[0].ok);
    assert.match(r.line, /self-check passed/);
    // the inherited CCP_HARNESS_DIR did not leak: the journal is inside the room's project
    assert.ok(existsSync(join(r.room, 'project', 'harness')));
    assert.ok(!existsSync('/nonexistent/leak'));
  } finally { rmSync(r.room, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});

for (const file of ['plugins/harness/scripts/notice-behind.mjs', 'plugins/harness/scripts/fingerprint.mjs']) {
  test(`deleting ${file} fails the clean room and the self-check names it`, () => {
    const repo = copyOfHead(file);
    const r = run(repo);
    try {
      assert.equal(r.passed, false);
      assert.match(r.line ?? '', new RegExp(`self-check FAILED.*missing ${file.split('/').slice(2).join('/').replace('.', '\\.')}`));
      assert.ok(r.steps.some((s) => s.step === 'selfcheck' && !s.ok));
    } finally { rmSync(r.room, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
  });
}
