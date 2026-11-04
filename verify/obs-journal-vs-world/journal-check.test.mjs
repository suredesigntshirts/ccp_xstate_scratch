// Verifier tests for plan item obs-journal-vs-world. Fixture: fixture/, recorded by the verifier: a headless
// `claude -p` session with the harness plugin (Bash x2, Read, one subagent with one Bash call), its transcripts,
// the journal the plugin wrote, a copy of the transcript reshaped as a list_events page, and the real GitHub
// closed-PR responses of the scratch repo (PR 12 squash-merged by hand through REST). Truth is read from the
// transcripts' tool_use blocks, not from the builder's code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixture');
const BIN = join(HERE, '..', '..', 'packages', 'journal', 'bin', 'journal-check.js');
const jsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SUBS = readdirSync(join(FIX, 'session', 'subagents')).filter((n) => n.endsWith('.jsonl'));

// Every tool_use id in the parent and subagent transcripts.
const truth = [join(FIX, 'session.jsonl'), ...SUBS.map((n) => join(FIX, 'session', 'subagents', n))]
  .flatMap(jsonl)
  .flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []))
  .filter((b) => b.type === 'tool_use')
  .map((b) => ({ id: b.id, name: b.name }));

const rows = jsonl(join(FIX, 'journal.jsonl'));
const toolRows = rows.filter((r) => r.kind === 'tool.call');

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: '', https_proxy: '', ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'jc-'));
const without = (id) => {
  const f = join(tmp(), 'copy.jsonl');
  writeFileSync(f, rows.filter((r) => !(r.kind === 'tool.call' && r.source.ref === id)).map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
};

test('fixture sanity: the transcripts hold a subagent call and the journal one row per call', () => {
  assert.equal(truth.length, 5);
  assert.ok(truth.some((t) => t.name === 'Agent'));
  assert.deepEqual(toolRows.map((r) => r.source.ref).sort(), truth.map((t) => t.id).sort());
  assert.ok(toolRows.some((r) => r.agent), 'one row is attributed to the subagent');
});

for (const [shape, events] of [['transcript', join(FIX, 'session.jsonl')], ['list_events page', join(FIX, 'list-events-page.json')]]) {
  test(`session-diff (${shape}): the whole journal shows 0 missing, exit 0`, () => {
    const r = run(['--journal', join(FIX, 'journal.jsonl'), '--events', events, '--json']);
    assert.equal(r.code, 0, r.out + r.err);
    const got = JSON.parse(r.out);
    assert.equal(got.session.missing.length, 0);
    assert.equal(got.session.unfound.length, 0);
    assert.equal(got.session.calls, truth.length);
  });

  test(`session-diff (${shape}): deleting any one tool.call row lists exactly that call (all ${truth.length}, subagent's included)`, () => {
    for (const t of truth) {
      const r = run(['--journal', without(t.id), '--events', events, '--json']);
      assert.equal(r.code, 1, `${t.name} ${t.id}`);
      const got = JSON.parse(r.out);
      assert.deepEqual(got.session.missing.map((c) => [c.id, c.tool]), [[t.id, t.name]]);
      assert.equal(got.session.unfound.length, 0);
    }
  });
}

test('session-diff: an invented tool.call row (no such call in the log) is listed as unfound', () => {
  const f = join(tmp(), 'extra.jsonl');
  const fake = { ...toolRows[0], id: '00000000-0000-4000-8000-000000000000', source: { ...toolRows[0].source, ref: 'toolu_INVENTED' } };
  writeFileSync(f, [...rows, fake].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = run(['--journal', f, '--events', join(FIX, 'session.jsonl'), '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).session.unfound.map((u) => u.ref), ['toolu_INVENTED']);
});

test('session-diff: an empty journal lists every call', () => {
  const f = join(tmp(), 'empty.jsonl');
  writeFileSync(f, '');
  const r = run(['--journal', f, '--events', join(FIX, 'session.jsonl'), '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).session.missing.map((c) => c.id).sort(), truth.map((t) => t.id).sort());
});

// GitHub's responses for the scratch repo, as recorded: #12 merged by hand (squash, REST), #11 merged via MCP, #10 closed unmerged.
const PRS = join(FIX, 'scratch-closed-prs.json');
const REPO = 'suredesigntshirts/ccp_xstate_scratch';
const prRows = (sha12) => {
  const f = join(tmp(), 'j.jsonl');
  const base = rows.find((r) => r.kind === 'tool.call');
  writeFileSync(f, JSON.stringify({ ...base, id: '11111111-1111-4111-8111-111111111111', kind: 'pr.merge', agent: null, source: { system: 'github', ref: `${REPO}#12` },
    payload: { repo: REPO, number: 12, sha: sha12, tool: 'mcp__github__merge_pull_request', toolUseId: null } }) + '\n');
  return f;
};

test('real-merge / merge-diff (recorded responses): a merge with no pr.merge row is listed; the closed-unmerged PR is not', () => {
  const r = run(['--journal', join(FIX, 'journal.jsonl'), '--repo', REPO, '--prs', PRS, '--since', '2026-10-30T18:00:00Z', '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).merges.unexplained.map((p) => p.number).sort(), [11, 12]);
});

test('real-merge / merge-diff: a pr.merge row for #12 removes it from the list, leaving #11', () => {
  const r = run(['--journal', prRows('659abad016bec122fd6bd0479de8acf764a85879'), '--repo', REPO, '--prs', PRS, '--since', '2026-10-30T18:00:00Z', '--json']);
  assert.deepEqual(JSON.parse(r.out).merges.unexplained.map((p) => p.number), [11]);
  assert.equal(JSON.parse(r.out).merges.unfound.length, 0);
});

test('merge-diff: a pr.merge row with a wrong sha is listed as not borne out', () => {
  const r = run(['--journal', prRows('0'.repeat(40)), '--repo', REPO, '--prs', PRS, '--since', '2026-10-30T18:00:00Z', '--json']);
  assert.equal(JSON.parse(r.out).merges.unfound.length, 1);
});

test('merge-diff: --since after the merge hides it', () => {
  const r = run(['--journal', join(FIX, 'journal.jsonl'), '--repo', REPO, '--prs', PRS, '--since', '2026-10-30T18:30:00Z', '--json']);
  assert.equal(r.code, 0);
});
