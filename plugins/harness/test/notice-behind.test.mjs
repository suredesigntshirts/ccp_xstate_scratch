// The UserPromptSubmit hook, run as Claude Code runs it, from a copy the real setup script installed.
// Expect lines behind-notice and no-self-edit (plan item self-update-by-version).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { context, fakeRepo, runHook, setup, snapshot, temp } from './helpers.mjs';

const home = join(temp('home'), 'home');
mkdirSync(home);
setup(home);
const INSTALLED = join(home, '.claude', 'skills', 'ccp-harness');
const HOOK = join(INSTALLED, 'scripts', 'notice-behind.mjs');
const VERSION = JSON.parse(readFileSync(join(INSTALLED, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const INPUT = { session_id: 'notice-1', hook_event_name: 'UserPromptSubmit', prompt: 'hi' };

function project() {
  const dir = temp('project');
  execFileSync(process.execPath, [join(INSTALLED, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, HOME: home, CCP_HARNESS_DIR: dir } });
  return dir;
}

/** Runs the hook in an installed project against a repo whose origin has `tags`; returns the session's line or null. */
function prompt({ dir, state, repo, input = INPUT }) {
  const r = runHook(HOOK, { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: state, CCP_REPO: repo }, input });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  return r.stdout ? context(r.stdout) : null;
}

const rewind = (state, minutes) => {
  const [file] = readdirSync(state);
  writeFileSync(join(state, file), JSON.stringify({ checkedAt: new Date(Date.now() - minutes * 60000).toISOString() }));
};

test('behind-notice: a session on an older release is told once, then not again within 30 minutes', () => {
  const dir = project(), state = temp('state');
  const repo = fakeRepo({ tags: [VERSION, '0.9.0', '0.10.0'] });
  const line = prompt({ dir, state, repo });
  assert.equal(line, `ccp-harness: this session runs release ${VERSION}, but 0.10.0 (harness-v0.10.0) is out. Plugins load only when a session starts, so this session keeps ${VERSION}; finish or hand off the current step, then a new thread runs 0.10.0.`);
  assert.equal(prompt({ dir, state, repo }), null);
  rewind(state, 29);
  assert.equal(prompt({ dir, state, repo }), null);
  rewind(state, 31);
  assert.match(prompt({ dir, state, repo }), /but 0\.10\.0 \(harness-v0\.10\.0\) is out/);
  assert.equal(prompt({ dir, state, repo }), null);
});

test('behind-notice: each session has its own 30 minutes', () => {
  const dir = project(), state = temp('state');
  const repo = fakeRepo({ tags: ['0.9.0'] });
  assert.ok(prompt({ dir, state, repo }));
  assert.ok(prompt({ dir, state, repo, input: { ...INPUT, session_id: 'notice-2' } }));
  assert.equal(readdirSync(state).length, 2);
});

test('behind-notice: nothing is said on the newest release, with no release, or when origin cannot be reached', () => {
  const dir = project();
  assert.equal(prompt({ dir, state: temp('state'), repo: fakeRepo({ tags: [VERSION] }) }), null);
  assert.equal(prompt({ dir, state: temp('state'), repo: fakeRepo({ tags: ['0.0.1'] }) }), null);
  assert.equal(prompt({ dir, state: temp('state'), repo: fakeRepo() }), null);
  const repo = fakeRepo({ tags: ['0.9.0'] });
  execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', join(repo, 'nowhere.git')]);
  assert.equal(prompt({ dir, state: temp('state'), repo }), null);
});

test('behind-notice: inert with no install marker or with CCP_HARNESS_DISABLED=1, and writes no state', () => {
  const state = temp('state'), repo = fakeRepo({ tags: ['0.9.0'] });
  assert.equal(prompt({ dir: temp('nomarker'), state, repo }), null);
  const r = runHook(HOOK, { env: { HOME: home, CCP_HARNESS_DIR: project(), CCP_HARNESS_STATE: state, CCP_REPO: repo, CCP_HARNESS_DISABLED: '1' }, input: INPUT });
  assert.equal(r.stdout, '');
  assert.deepEqual(readdirSync(state), []);
});

test('no-self-edit: the notice hook writes nothing under the plugin root it runs from', () => {
  const dir = project(), before = snapshot(INSTALLED);
  const repo = fakeRepo({ tags: ['0.9.0'] });
  assert.ok(prompt({ dir, state: temp('state'), repo }));
  const r = runHook(HOOK, { env: { HOME: home, CCP_HARNESS_DIR: dir, CCP_REPO: repo }, input: { ...INPUT, session_id: `default-state-${process.pid}` } });
  assert.ok(r.stdout);
  assert.deepEqual(snapshot(INSTALLED), before);
});

test('behind-notice: a newer release published as a branch release/harness-v<x.y.z> is noticed too', () => {
  const dir = project(), state = temp('state');
  const repo = fakeRepo({ tags: [VERSION] });
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:refs/heads/release/harness-v0.9.1']);
  assert.match(prompt({ dir, state, repo }), /but 0\.9\.1 \(harness-v0\.9\.1\) is out/);
});
