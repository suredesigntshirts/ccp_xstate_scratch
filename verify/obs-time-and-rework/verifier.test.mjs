// Verifier tests for plan item obs-time-and-rework (rework, tripwire). Independent of the builder's tests.
// rework: raw GitHub REST responses for real PRs of this repo (#14, #28, #31), saved in fixtures/, are counted here by
// a separate counter written from the decision file's definitions and compared with the builder's derived view.
// tripwire: case C-second-fail-replans (a FAIL, a rebuild, a second FAIL, then a third round) through the real
// `derive.js rework --append` into a temp journal file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prFacts } from '../../packages/journal/bin/derive.js';
import { ciRows, rework } from '../../packages/journal/src/derive/rework.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DERIVE = join(ROOT, 'packages', 'journal', 'bin', 'derive.js');
const REPO = 'suredesigntshirts/ccp_xstate';
const RED = ['failure', 'timed_out', 'action_required', 'startup_failure'];

// My own counter, straight from the raw REST bodies: a push is a PR commit with check runs; a round starts at the
// first push and at each push after a red one, a merge commit (two parents) staying in its round.
function count(raw, n) {
  const commits = raw[`/repos/${REPO}/pulls/${n}/commits?per_page=100&page=1`];
  const pushes = commits.map((c) => ({ merge: c.parents.length > 1, runs: raw[`/repos/${REPO}/commits/${c.sha}/check-runs?per_page=100`].check_runs }))
    .filter((p) => p.runs.length > 0);
  let rounds = 0, prevRed = true, redPushes = 0, redRuns = 0;
  for (const p of pushes) {
    const red = p.runs.filter((r) => RED.includes(r.conclusion)).length;
    if (prevRed && !(p.merge && rounds > 0)) rounds++;
    prevRed = red > 0;
    if (red) redPushes++;
    redRuns += red;
  }
  return { pushes: pushes.length, redPushes, redRuns, rounds };
}
const load = (n) => JSON.parse(readFileSync(join(ROOT, 'verify', 'obs-time-and-rework', 'fixtures', `pr-${n}.json`), 'utf8'));

// What I read off GitHub by hand when picking the PRs (see verdict.json): pinned so the counter itself is checked.
const HAND = { 14: { pushes: 8, redPushes: 7, redRuns: 10, rounds: 7 }, 28: { pushes: 5, redPushes: 4, redRuns: 11, rounds: 4 }, 31: { pushes: 3, redPushes: 1, redRuns: 1, rounds: 2 } };

for (const n of [14, 28, 31]) {
  test(`rework: PR #${n}, derived pushes, red runs and rounds equal what GitHub's commits and check runs show`, async () => {
    const raw = load(n);
    assert.deepEqual(count(raw, n), HAND[n], 'my counter agrees with the hand count');
    const facts = await prFacts(REPO, n, { get: async (p) => { if (!(p in raw)) throw new Error(`not recorded: ${p}`); return raw[p]; } });
    const view = rework(ciRows(facts, { session: 'v', release: '0.0.0' })).prs.find((p) => p.pr === n);
    const { pushes, redPushes, redRuns, rounds } = view;
    assert.deepEqual({ pushes, redPushes, redRuns, rounds }, HAND[n]);
  });
}

const run = (...args) => spawnSync(process.execPath, [DERIVE, ...args], { encoding: 'utf8' });
const readRows = (path) => readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// A PR whose CI is red in its first three pushes (a FAIL, a rebuild, a second FAIL, a rebuild) and green from the fourth; run ids depend on the PR and push alone, so a longer history only adds runs.
function prWithRounds(n, rounds, number = 900) {
  const commits = [];
  for (let i = 0; i < rounds; i++) {
    const t = `2026-10-30T0${i}:00:00Z`;
    commits.push({ sha: `sha${i}`.padEnd(40, '0'), parents: 1, at: t, checkRuns: [
      { id: number * 100 + i * 2, name: 'gates', status: 'completed', conclusion: i < 3 ? 'failure' : 'success', startedAt: t, completedAt: t },
      { id: number * 100 + i * 2 + 1, name: 'test', status: 'completed', conclusion: 'success', startedAt: t, completedAt: t },
    ] });
  }
  return { repo: 'o/r', number, head: 'build/x', merged: false, item: 'x-item', labels: [], sessions: [], files: [], commits };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-tripwire-'));
  const plan = join(dir, 'items');
  mkdirSync(plan);
  return { dir, plan, journal: join(dir, 'journal.jsonl'), facts: (f) => { const p = join(dir, `facts-${f.length}-${f[0].commits.length}.json`); writeFileSync(p, JSON.stringify(f)); return p; } };
}
const append = (s, factsPath, extra = []) => {
  const r = run('rework', '--facts', factsPath, '--plan', s.plan, '--append', s.journal, '--session', 'verifier', '--release', '1.0.0', ...extra);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const trips = (s) => readRows(s.journal).filter((r) => r.kind === 'tripwire');

test('tripwire: two rounds (a FAIL and a rebuild) is at the limit and writes no tripwire', () => {
  const s = setup();
  const view = append(s, s.facts([prWithRounds('green', 2)]));
  assert.equal(view.prs[0].rounds, 2);
  assert.equal(trips(s).length, 0);
});

test('tripwire: C-second-fail-replans, the third round writes exactly one row; running again, or a fourth round, writes no second for the same limit', () => {
  const s = setup();
  const f3 = s.facts([prWithRounds('green', 3)]);
  const first = append(s, f3);
  assert.equal(first.prs[0].rounds, 3);
  assert.equal(first.tripwires.length, 1);
  assert.equal(trips(s).length, 1);
  const row = trips(s)[0];
  assert.equal(row.kind, 'tripwire');
  assert.equal(row.payload.pr, 900);
  assert.equal(row.payload.rounds, 3);
  assert.equal(row.payload.limit, 2);
  const ciBefore = readRows(s.journal).filter((r) => r.kind === 'ci.result').length;
  assert.equal(ciBefore, 6);

  // The same facts again: nothing new at all.
  const again = append(s, f3);
  assert.equal(again.tripwires.length, 0);
  assert.equal(trips(s).length, 1);
  assert.equal(readRows(s.journal).filter((r) => r.kind === 'ci.result').length, ciBefore, 'ci.result rows are not duplicated');

  // The PR goes on to a fourth round: same limit, so still one row.
  const f4 = s.facts([prWithRounds('green', 4)]);
  assert.equal(append(s, f4).tripwires.length, 0);
  assert.equal(trips(s).length, 1);
});

test('tripwire: the limit is the item\'s step_back.max_rounds, and a different limit is a different tripwire', () => {
  const s = setup();
  writeFileSync(join(s.plan, 'x-item.md'), '```json\n{ "id": "x-item", "step_back": { "max_rounds": 3 } }\n```\n');
  const f3 = s.facts([prWithRounds('green', 3)]);
  assert.equal(append(s, f3).tripwires.length, 0, 'three rounds is at a limit of 3');
  assert.equal(trips(s).length, 0);
  const f4 = s.facts([prWithRounds('green', 4)]);
  const out = append(s, f4);
  assert.equal(out.tripwires.length, 1);
  assert.equal(trips(s)[0].payload.limit, 3);
  // The item's limit changes to 2: the PR is past that limit too, and no tripwire holds that limit yet.
  writeFileSync(join(s.plan, 'x-item.md'), '```json\n{ "id": "x-item", "step_back": { "max_rounds": 2 } }\n```\n');
  assert.equal(append(s, f4).tripwires.length, 1);
  assert.deepEqual(trips(s).map((r) => r.payload.limit), [3, 2]);
});

test('tripwire: without --append nothing is written, and two PRs past the limit get one row each', () => {
  const s = setup();
  const f = s.facts([prWithRounds('green', 3, 901), prWithRounds('green', 3, 902)]);
  const r = run('rework', '--facts', f);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).tripwires.length, 2);
  append(s, f);
  assert.deepEqual(trips(s).map((t) => t.payload.pr).sort(), [901, 902]);
});
