// The cloud setup script (infra/cloud-environment/setup.sh), run for real against a temp HOME.
// Expect lines clean-home, copy-not-link and no-values-logged (plan item env-bootstrap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, RULES, TEST_REF, setup, snapshot, temp } from '../plugins/harness/test/helpers.mjs';

const fresh = () => {
  const home = join(temp('home'), 'home');
  mkdirSync(home);
  return home;
};
const contents = (dir) => Object.fromEntries(Object.keys(snapshot(dir)).map((p) => [p.slice(dir.length), readFileSync(p, 'utf8')]));

test('clean-home: two runs against an empty HOME leave the same ~/.claude files', () => {
  const home = fresh();
  setup(home);
  const first = contents(join(home, '.claude'));
  setup(home);
  assert.deepEqual(contents(join(home, '.claude')), first);
  const settings = JSON.parse(first['/settings.json']);
  assert.equal(settings.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '3');
  assert.deepEqual(settings.autoMode.allow, RULES);
  assert.ok(first['/skills/ccp-harness/.claude-plugin/plugin.json']);
  assert.ok(first['/skills/ccp-harness/hooks/hooks.json']);
  assert.ok(first['/skills/ccp-harness/lib/journal/src/index.js']);
});

test('setup keeps settings already in ~/.claude/settings.json and adds the repo rules once', () => {
  const home = fresh();
  mkdirSync(join(home, '.claude'));
  execFileSync('bash', ['-c', `echo '{"model":"x","autoMode":{"allow":["mine"]}}' > "${home}/.claude/settings.json"`]);
  setup(home);
  setup(home);
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'x');
  assert.deepEqual(settings.autoMode.allow, ['mine', ...RULES.filter((r) => r !== 'mine')]);
});

test('copy-not-link: the installed plugin is a copy of a commit, not the working tree', () => {
  const home = fresh();
  setup(home);
  const dest = join(home, '.claude', 'skills', 'ccp-harness');
  assert.equal(lstatSync(dest).isSymbolicLink(), false);
  for (const p of Object.keys(snapshot(dest))) assert.equal(lstatSync(p).isSymbolicLink(), false, p);
  const release = JSON.parse(readFileSync(join(dest, 'release.json'), 'utf8'));
  const head = execFileSync('git', ['-C', REPO, 'rev-parse', TEST_REF], { encoding: 'utf8' }).trim();
  assert.equal(release.tag, null);
  assert.equal(release.commit, head);
  assert.equal(release.version, JSON.parse(readFileSync(join(dest, '.claude-plugin', 'plugin.json'), 'utf8')).version);
  assert.deepEqual(release.files, Object.keys(snapshot(dest)).map((p) => p.slice(dest.length + 1)).filter((p) => p !== 'release.json').toSorted());
  assert.equal(existsSync(join(dest, 'test')), false);
});

test('copy-not-link: replacing the installed copy leaves no old files behind', () => {
  const home = fresh();
  setup(home);
  const dest = join(home, '.claude', 'skills', 'ccp-harness');
  cpSync(join(dest, 'package.json'), join(dest, 'stray.txt'));
  setup(home);
  assert.equal(existsSync(join(dest, 'stray.txt')), false);
  assert.deepEqual(readdirSync(join(home, '.claude', 'skills')), ['ccp-harness']);
});

test('no-values-logged: the setup log names environment variables but never their values', () => {
  const home = fresh();
  const secret = 'sk-test-9f8e7d6c5b4a3f2e1d0c';
  const log = setup(home, { CCP_FAKE_API_TOKEN: secret, CCP_FAKE_PASSWORD: `pw-${secret}` });
  assert.match(log, /env names: .*\bCCP_FAKE_API_TOKEN\b/);
  assert.match(log, /\bCCP_FAKE_PASSWORD\b/);
  assert.equal(log.includes(secret), false);
  assert.equal(log.includes('9f8e7d6c'), false);
});

test('copy-not-link: with release tags, setup installs the newest release by version, not the HEAD', () => {
  const clone = join(temp('clone'), 'repo');
  execFileSync('git', ['clone', '-q', REPO, clone]);
  for (const t of ['harness-v0.1.9', 'harness-v0.1.10', 'harness-v0.0.20']) execFileSync('git', ['-C', clone, 'tag', '-f', t]);
  const home = fresh();
  execFileSync('bash', [join(clone, 'infra', 'cloud-environment', 'setup.sh')], { env: { ...process.env, HOME: home, CCP_SETUP_LOG: join(home, '..', 'log'), CCP_SETUP_FETCH: '0' } });
  const release = JSON.parse(readFileSync(join(home, '.claude', 'skills', 'ccp-harness', 'release.json'), 'utf8'));
  assert.equal(release.tag, 'harness-v0.1.10');
  assert.match(readFileSync(join(home, '..', 'log'), 'utf8'), /plugin ccp-harness \S+ from harness-v0\.1\.10 /);
});
