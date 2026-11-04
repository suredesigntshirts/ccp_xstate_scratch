// bin/host.js wake reads events only from a hook's prompt or a ReadNotifications result's GitHub notifications.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('../bin/host.js', import.meta.url).pathname;
const checkRun = readFileSync(new URL('./fixtures/wakes/check-run-failed.txt', import.meta.url), 'utf8');
const host = (root, args, input) => {
  const out = spawnSync(process.execPath, [cli, ...args, '--item', 'it', '--workflow', 'quick-fix', '--root', root, '--release', '0.2.0'], { input, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
};
const started = () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-bin-'));
  host(root, ['start', '--session', 'owner', '--input', JSON.stringify({ issue: { url: 'u', expect: ['e'] } })]);
  return root;
};
const wake = (root, hook) => host(root, ['wake'], JSON.stringify({ session_id: 'owner', ...hook })).results;

test("another tool's output is never read as a wake, whatever it holds", () => {
  const root = started();
  assert.deepEqual(wake(root, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: checkRun } }), []);
  const fromAgent = { notifications: [{ origin: 'agent_message', content: checkRun }] };
  assert.deepEqual(wake(root, { hook_event_name: 'PostToolUse', tool_name: 'ReadNotifications', tool_response: fromAgent }), []);
});

test("a ReadNotifications result's GitHub notification is offered, with GitHub as its source", () => {
  const root = started();
  const response = { notifications: [{ origin: 'github_webhook', content: checkRun }], remaining: 0 };
  const [result] = wake(root, { hook_event_name: 'PostToolUse', tool_name: 'ReadNotifications', tool_response: response });
  assert.equal(result.event, 'github.check_run.completed');
  assert.equal(result.source.system, 'github');
  // quick-fix takes no GitHub event yet, so it is journalled refused.
  assert.equal(result.outcome, 'refused');
  const [prompted] = wake(root, { hook_event_name: 'UserPromptSubmit', prompt: checkRun });
  assert.equal(prompted.outcome, 'duplicate');
});
