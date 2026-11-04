// The rework view and the tripwire (plan item obs-time-and-rework, Expect `rework` and `tripwire`). The fixture is
// six real ccp_xstate PRs as GitHub REST showed them on 2026-10-30 (derive.js rework --save-facts); the expected
// counts were read off those commits and check runs by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/index.js';
import { ciRows, rework, tripwires } from '../src/derive/rework.js';

const facts = JSON.parse(readFileSync(new URL('./fixtures/derive/ccp_xstate-prs.json', import.meta.url), 'utf8'));
const envelope = { session: 'test', release: '0.1.4' };
const rows = facts.flatMap((f) => ciRows(f, envelope));
const byPr = (view, n) => view.prs.find((p) => p.pr === n);

test('ci.result rows are valid journal rows, one per completed check run', () => {
  for (const r of rows) assert.deepEqual(validate({ v: 1, ...r }), []);
  const runs = facts.flatMap((f) => f.commits.flatMap((c) => c.checkRuns)).filter((r) => r.status === 'completed');
  assert.equal(rows.length, runs.length);
});

test('pushes, red pushes, red runs and rounds match the PRs\' commits and check runs', () => {
  const view = rework(rows);
  const got = (n) => { const p = byPr(view, n); return [p.pushes, p.redPushes, p.redRuns, p.rounds]; };
  assert.deepEqual(got(13), [1, 0, 0, 1]); // one push, all green
  assert.deepEqual(got(14), [8, 7, 10, 7]); // seven red pushes; the merge of main after the fifth stays in its round
  assert.deepEqual(got(28), [5, 4, 11, 4]); // four red pushes, then a green merge of main
});

test('rows read twice count once, and --checks narrows which checks count', () => {
  assert.deepEqual(rework([...rows, ...rows]), rework(rows));
  const onlyTest = byPr(rework(rows, { checks: ['test'] }), 14);
  assert.ok(onlyTest.redRuns < byPr(rework(rows), 14).redRuns);
});

test('a PR labelled replan counts as a replan of every other PR of its item', () => {
  const pr13 = facts.find((f) => f.number === 13);
  const commits = pr13.commits.map((c) => ({ ...c, checkRuns: c.checkRuns.map((r) => ({ ...r, id: `99-${r.id}` })) }));
  const replan = { ...pr13, number: 99, labels: ['replan'], item: 'wf-quick-fix', commits };
  const view = rework([...rows, ...ciRows(replan, envelope)]);
  assert.equal(byPr(view, 14).replans, 1);
  assert.equal(byPr(view, 99).replans, 0);
});

test('a PR past its limit emits one tripwire row, and none again for the same limit', () => {
  const view = rework(rows);
  const first = tripwires(view, rows, envelope);
  assert.deepEqual(first.map((t) => [t.payload.pr, t.payload.rounds, t.payload.limit]).sort((a, b) => a[0] - b[0]),
    [[14, 7, 2], [28, 4, 2], [29, 4, 2]]);
  for (const t of first) assert.deepEqual(validate({ v: 1, id: 'x', at: '2026-10-30T00:00:00.000Z', ...t }), []);
  const written = first.map((t, i) => ({ ...t, id: `trip-${i}` }));
  assert.deepEqual(tripwires(view, [...rows, ...written], envelope), []);
  // A new limit for the same PR is a new trip.
  const again = tripwires(view, [...rows, ...written], envelope, { limitOf: (pr) => (pr.pr === 14 ? 5 : 2) });
  assert.deepEqual(again.map((t) => [t.payload.pr, t.payload.limit]), [[14, 5]]);
});

test('derive.js rework --append writes the check rows and tripwires once, however often it runs', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readFile } = await import('../src/index.js');
  const bin = new URL('../bin/derive.js', import.meta.url).pathname;
  const fixture = new URL('./fixtures/derive/ccp_xstate-prs.json', import.meta.url).pathname;
  const file = join(mkdtempSync(join(tmpdir(), 'derive-')), 'item.jsonl');
  const run = () => JSON.parse(execFileSync(process.execPath, [bin, 'rework', '--facts', fixture, '--append', file, '--session', 'test', '--release', '0.1.4'], { encoding: 'utf8' }));
  const first = run();
  assert.equal(first.tripwires.length, 3);
  const after = readFile(file);
  assert.equal(after.bad.length, 0);
  assert.equal(after.rows.filter((r) => r.kind === 'tripwire').length, 3);
  assert.equal(after.rows.filter((r) => r.kind === 'ci.result').length, rows.length);
  assert.equal(run().tripwires.length, 0);
  assert.equal(readFile(file).rows.length, after.rows.length);
});
