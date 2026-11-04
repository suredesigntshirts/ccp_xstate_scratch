// Verifier tests for plan item obs-refusal-log (captured, retry-linked). Independent of the builder's tests: the
// input is the probe's recorded PermissionDenied event, read straight from the probe fixture and sent through the
// real hook script (capture.mjs) into a temp harness folder; expectations come from the fixture, not from builder rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = join(ROOT, 'plugins', 'harness');
const FIXTURE = join(ROOT, 'probes', 'platform', 'fixtures', 'refusals', '2026-10-30-self-modification-live-mod-and-hook.jsonl');
const lines = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const denied = lines.find((l) => l.hook === 'PermissionDenied').input;
const sha = (t) => createHash('sha256').update(t).digest('hex');

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-refusal-'));
  execFileSync(process.execPath, [join(PLUGIN, 'scripts', 'install.mjs')], { env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir } });
  return dir;
}
function fire(dir, input) {
  const r = spawnSync(process.execPath, [join(PLUGIN, 'scripts', 'capture.mjs')], {
    input: JSON.stringify({ ...input, transcript_path: join(dir, 'none.jsonl') }), encoding: 'utf8',
    env: { PATH: process.env.PATH, CCP_HARNESS_DIR: dir, CCP_HARNESS_STATE: join(dir, 'state') },
  });
  assert.equal(r.status, 0, r.stderr);
}
const rowsOf = (dir) => readFileSync(join(dir, 'journal', 'sessions', `${denied.session_id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('the fixture really holds a classifier refusal with a bracketed rule', () => {
  assert.equal(denied.hook_event_name, 'PermissionDenied');
  assert.match(denied.reason, /^\[[A-Za-z -]+\]$/);
});

test('captured: exactly one refusal row, source classifier, rule = the fixture reason, tool and action hash from the fixture', () => {
  const dir = harness();
  fire(dir, denied);
  const refusals = rowsOf(dir).filter((r) => r.kind === 'refusal');
  assert.equal(refusals.length, 1);
  const p = refusals[0].payload;
  assert.equal(p.source, 'classifier');
  assert.equal(p.rule, denied.reason);
  assert.equal(p.tool, denied.tool_name);
  assert.equal(p.retryOf, null);
  assert.equal(p.outcome, 'denied');
  const { description, ...rest } = denied.tool_input;
  assert.equal(p.actionHash, sha(JSON.stringify([denied.tool_name, rest])));
  assert.ok(!JSON.stringify(refusals).includes(denied.tool_input.command.slice(0, 40)), 'row leaks the command');
});

test('retry-linked: an identical action (reworded description) later links by retryOf to the first row; a different one does not', () => {
  const dir = harness();
  fire(dir, denied);
  fire(dir, { ...denied, tool_use_id: 'toolu_VERIFY_retry', tool_input: { ...denied.tool_input, description: 'reworded by the model' } });
  fire(dir, { ...denied, tool_use_id: 'toolu_VERIFY_other', tool_input: { command: 'echo something else entirely' } });
  const [a, b, c] = rowsOf(dir).filter((r) => r.kind === 'refusal');
  assert.equal(a.payload.retryOf, null);
  assert.equal(b.payload.retryOf, a.id);
  assert.equal(c.payload.retryOf, null);
  assert.equal(b.payload.actionHash, a.payload.actionHash);
  assert.notEqual(c.payload.actionHash, a.payload.actionHash);
});
