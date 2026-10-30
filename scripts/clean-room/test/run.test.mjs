// The clean-room runner (plan item clean-room-install-test), run for real: the setup script into an empty HOME, the
// install into an empty project, and the SessionStart hooks without a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, TEST_REF, temp } from '../../../plugins/harness/test/helpers.mjs';
import { cleanRoom, harnessHook, report } from '../run.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('green: the plugin at this commit passes the clean room, with the self-check line and both journal rows', (t) => {
  const r = cleanRoom({ repo: REPO, ref: TEST_REF, session: 'hooks' });
  t.after(() => rmSync(r.room, { recursive: true, force: true }));
  assert.equal(r.passed, true, report(r));
  assert.equal(r.mode, 'hooks without a model');
  assert.match(r.line, /^ccp-harness \d+\.\d+\.\d+: self-check passed \(7 of 7 checks\)\.$/);
  assert.deepEqual(r.steps.map((s) => s.step), ['empty', 'setup', 'install', 'session', 'selfcheck', 'journal']);
});

for (const gone of ['scripts/notice-behind.mjs', 'scripts/fingerprint.mjs']) {
  test(`catches: a commit that deletes ${gone} fails the clean room, and the self-check names the file`, (t) => {
    const clone = join(temp('clean-room-clone'), 'repo');
    git(REPO, 'clone', '-q', REPO, clone);
    git(clone, 'checkout', '-q', '--detach', execFileSync('git', ['-C', REPO, 'rev-parse', TEST_REF], { encoding: 'utf8' }).trim());
    git(clone, 'rm', '-q', `plugins/harness/${gone}`);
    git(clone, 'commit', '-qm', `delete ${gone}`);
    const r = cleanRoom({ repo: clone, ref: 'HEAD', session: 'hooks' });
    t.after(() => rmSync(r.room, { recursive: true, force: true }));
    assert.equal(r.passed, false);
    assert.match(r.line, /self-check FAILED\./);
    assert.ok(r.line.includes(`missing ${gone}`), r.line);
    assert.equal(r.steps.find((s) => s.step === 'selfcheck').ok, false);
  });
}

test('harnessHook finds ccp-harness among the SessionStart hook responses of a stream-json transcript', () => {
  const ev = (o) => JSON.stringify({ type: 'system', hook_event: 'SessionStart', ...o });
  const out = { hookSpecificOutput: { additionalContext: 'ccp-harness 0.1.0: self-check passed (7 of 7 checks).' } };
  const transcript = [
    ev({ subtype: 'hook_started' }), ev({ subtype: 'hook_started' }),
    ev({ subtype: 'hook_response', output: 'other-plugin loaded' }),
    ev({ subtype: 'hook_response', output: `${JSON.stringify(out)}\n` }),
    '{"type":"assistant"}', 'not json'
  ].join('\n');
  const { ran, hook } = harnessHook(transcript);
  assert.equal(ran, 2);
  assert.match(hook.output, /self-check passed/);
  assert.deepEqual(harnessHook(ev({ subtype: 'hook_started' })), { ran: 1, hook: null });
});
