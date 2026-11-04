// The journal check (plan item obs-journal-vs-world): the session diff and the merge diff, on recorded inputs. The
// GitHub responses are the scratch repo's closed PRs as its REST API returned them on 2026-10-30 (PR 11 was merged
// with the GitHub MCP merge tool, the others by earlier threads). Expect line merge-diff is this file's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from '../src/index.js';
import { checkMerges, checkSession, clean, parseEvents, prOf, toolUses } from '../src/check.js';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'bin', 'journal-check.js');
const PRS = join(here, 'fixtures', 'check', 'scratch-closed-prs.json');
const REPO = 'suredesigntshirts/ccp_xstate_scratch';
const prs = JSON.parse(readFileSync(PRS, 'utf8')).map((p) => prOf(REPO, p));

let n = 0;
const row = (kind, ref, payload, at = '2026-10-30T18:00:00.000Z') => ({
  v: 1, id: `row-${++n}`, at, kind, source: { system: kind === 'pr.merge' ? 'github' : 'claude-code', ref },
  session: 'test', agent: null, item: null, state: null, release: '0.1.3', payload,
});
const call = (id, tool, ok = true) => row('tool.call', id, { tool, inputHash: 'x', inputBytes: 1, ms: 1, ok });
const merge = (number, sha, at = '2026-10-30T18:13:00.000Z') =>
  row('pr.merge', `${REPO}#${number}`, { repo: REPO, number, sha, tool: 'mcp__github__merge_pull_request', toolUseId: null }, at);

// A transcript: two calls that ran, one Claude Code blocked, one still running.
const transcript = [
  { type: 'assistant', timestamp: '2026-10-30T18:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_a', name: 'Bash', input: {} }] } },
  { type: 'user', timestamp: '2026-10-30T18:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'ok' }] } },
  { type: 'assistant', timestamp: '2026-10-30T18:00:02.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_b', name: 'Read', input: {} }] } },
  { type: 'user', timestamp: '2026-10-30T18:00:03.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: [{ type: 'text', text: 'file' }] }] } },
  { type: 'assistant', timestamp: '2026-10-30T18:00:04.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_c', name: 'Bash', input: {} }] } },
  { type: 'user', timestamp: '2026-10-30T18:00:05.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_c', is_error: true, content: '<tool_use_error>Blocked: standalone sleep 25.</tool_use_error>' }] } },
  { type: 'assistant', timestamp: '2026-10-30T18:00:06.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_d', name: 'Bash', input: {} }] } },
];

// The same calls as list_events returns them: one page, events wrapped by role.
const page = {
  ccr: {
    data: transcript.map((e) => ({ created_at: e.timestamp, [e.type]: { uuid: 'u', internal_anthropic_catchall: { message: e.message, timestamp: e.timestamp } } })),
    has_more: false,
  },
};

const temp = () => mkdtempSync(join(tmpdir(), 'journal-check-'));
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const run = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });

test('session-diff: both event-log shapes give the same calls', () => {
  const a = [...toolUses(parseEvents(jsonl(transcript)).events).values()];
  const b = [...toolUses(parseEvents(JSON.stringify(page)).events).values()];
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((c) => [c.id, c.result]), [['toolu_a', 'ran'], ['toolu_b', 'ran'], ['toolu_c', 'not-run'], ['toolu_d', 'pending']]);
});

test('session-diff: a complete journal shows 0 missing; deleting one row shows exactly that call', () => {
  const { events } = parseEvents(jsonl(transcript));
  const rows = [call('toolu_a', 'Bash'), call('toolu_b', 'Read')];
  const full = checkSession({ rows, events });
  assert.deepEqual([full.missing, full.unfound], [[], []]);
  assert.deepEqual([full.notRun.map((c) => c.id), full.pending.map((c) => c.id)], [['toolu_c'], ['toolu_d']]);
  assert.ok(clean({ session: full }));
  const cut = checkSession({ rows: rows.slice(1), events });
  assert.deepEqual(cut.missing.map((c) => c.id), ['toolu_a']);
  assert.ok(!clean({ session: cut }));
});

test('session-diff: a row whose call the log does not have is listed, unless it falls outside the log', () => {
  const { events } = parseEvents(jsonl(transcript));
  const rows = [call('toolu_a', 'Bash'), call('toolu_b', 'Read'), call('toolu_ghost', 'Bash'), { ...call('toolu_old', 'Bash'), at: '2026-10-29T00:00:00.000Z' }];
  const got = checkSession({ rows, events });
  assert.deepEqual(got.unfound.map((r) => r.ref), ['toolu_ghost']);
  assert.equal(got.outside, 1);
});

test('merge-diff: a PR merged on GitHub with no journal row is listed', () => {
  const since = '2026-10-30T16:00:00Z';
  const got = checkMerges({ rows: [merge(11, 'ec58ae8d47798a6184078e8d86c935b58f67bcd2')], prs, repos: [REPO], since });
  assert.deepEqual(got.unexplained.map((p) => p.number), [9, 8, 7]);
  assert.match(got.unexplained[0].head, /^[0-9a-f]{40}$/);
  assert.deepEqual(got.unfound, []);
  // Closed without merging (PR 10) is no merge; older than --since (PR 6) is out of the window.
  assert.ok(!got.unexplained.some((p) => p.number === 10 || p.number === 6));
});

test('merge-diff: a pr.merge row GitHub does not bear out is listed', () => {
  const got = checkMerges({ rows: [merge(10, null), merge(11, 'f'.repeat(40))], prs, repos: [REPO], since: '2026-10-30T18:00:00Z' });
  assert.deepEqual(got.unfound.map((r) => [r.ref, r.why.split(',')[0]]), [
    [`${REPO}#10`, 'GitHub shows no merge of this PR'],
    [`${REPO}#11`, 'GitHub merged it as ec58ae8d47798a6184078e8d86c935b58f67bcd2'],
  ]);
});

// The host's merge effect ending done (plan item engine-effects, packages/engine/src/effects/merge.js).
const hostMerge = (number, sha, at = '2026-10-30T18:14:00.000Z') => ({
  ...row('engine.effect', `it-${number}:7.merge`, {
    effect: `it-${number}:7.merge`, type: 'run', phase: 'done', transition: `it-${number}#7`, actor: 'merge',
    outcome: { ref: `${REPO}#${number}`, repo: REPO, number, head: 'a'.repeat(40), sha }, rule: null, reason: null,
  }, at),
  source: { system: 'engine', ref: `it-${number}:7.merge` }, item: `it-${number}`,
});

test('outside-merge: every merge the host merge effect did not make is listed, even one a pr.merge row explains', () => {
  const since = '2026-10-30T16:00:00Z';
  const rows = [merge(11, 'ec58ae8d47798a6184078e8d86c935b58f67bcd2'), hostMerge(9, prs.find((p) => p.number === 9).sha)];
  const got = checkMerges({ rows, prs, repos: [REPO], since });
  assert.deepEqual(got.outsideHost.map((p) => p.number), [11, 8, 7]);
  assert.deepEqual(got.unexplained.map((p) => p.number), [8, 7]);
  assert.equal(got.hostRows, 1);
  assert.deepEqual(got.unfound, []);
  assert.equal(clean({ merges: { ...got, unexplained: [] } }), true, 'listed, not failed, without host');
  assert.equal(clean({ merges: { ...got, unexplained: [] }, host: true }), false);
});

test('outside-merge: a host merge row GitHub merged at another sha is not borne out', () => {
  const got = checkMerges({ rows: [hostMerge(9, 'f'.repeat(40))], prs, repos: [REPO], since: '2026-10-30T16:00:00Z' });
  assert.deepEqual(got.unfound.map((r) => r.ref), [`${REPO}#9`]);
});

test('the command: reports, exits 1 on a gap, and records a journal.check row with the counts', () => {
  const dir = temp();
  const journal = join(dir, 'session.jsonl');
  writeFileSync(journal, jsonl([call('toolu_b', 'Read'), merge(11, 'ec58ae8d47798a6184078e8d86c935b58f67bcd2')]));
  const events = join(dir, 'events.json');
  writeFileSync(events, JSON.stringify(page));
  const record = join(dir, 'checks.jsonl');
  const r = run(['--journal', journal, '--events', events, '--repo', REPO, '--prs', PRS, '--since', '2026-10-30T16:00:00Z', '--record', record]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /1 missing from the journal:\n {4}toolu_a {2}Bash/);
  assert.match(r.stdout, /3 merges with no journal row:\n {4}suredesigntshirts\/ccp_xstate_scratch#9 /);
  const { rows, bad } = readFile(record);
  assert.deepEqual(bad, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'journal.check');
  assert.deepEqual(rows[0].payload, {
    ok: false, since: '2026-10-30T16:00:00Z', journal, calls: 4, callRows: 1, missing: 1, notRun: 1, pending: 1,
    unfoundCalls: 0, outside: 0, merges: 4, mergeRows: 1, hostMerges: 0, unexplained: 3, outsideHost: 4, unfoundMerges: 0, badLines: 0,
  });
});

test('the command: exits 0 when nothing is listed, and 2 when it cannot run', () => {
  const dir = temp();
  const journal = join(dir, 'session.jsonl');
  writeFileSync(journal, jsonl([call('toolu_a', 'Bash'), call('toolu_b', 'Read')]));
  const events = join(dir, 'events.jsonl');
  writeFileSync(events, jsonl(transcript));
  const ok = run(['--journal', journal, '--events', events, '--json']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).counts.missing, 0);
  assert.equal(run(['--events', events]).status, 2);
  assert.equal(run(['--journal', join(dir, 'none.jsonl'), '--events', events]).status, 2);
});
