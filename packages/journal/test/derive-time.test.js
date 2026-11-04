// The time view (plan item obs-time-and-rework, Expect `time`): idle gaps are waiting or unknown, never working, and
// the parts sum to wall-clock time. The fixture is a real session's journal (one turn with a subagent), with a
// second turn copied after it so that a 10-minute idle gap sits between them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { time } from '../src/derive/time.js';

const real = readFileSync(new URL('./fixtures/derive/session.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const TEN_MIN = 10 * 60 * 1000;
const t = (iso) => Date.parse(iso);
const shift = (row, by, n) => ({ ...row, id: `${row.id}-${n}`, at: new Date(t(row.at) + by).toISOString() });

// The real session, then its turn (the wake and every row after it) again, starting 10 minutes after the first turn's
// last activity. A turn's activity starts with the capture hook that writes its wake row, just before the row.
const alone = Object.values(time(real).sessions)[0];
const firstStart = alone.gaps[0].to;
function withGap({ reason = 'mention', fingerprint = null } = {}) {
  const wake = real.find((r) => r.kind === 'wake');
  const turn = real.filter((r) => t(r.at) >= t(wake.at));
  const by = t(alone.to) - t(firstStart) + TEN_MIN;
  const second = turn.map((r) => shift(r, by, 2));
  const secondWake = second.find((r) => r.kind === 'wake');
  secondWake.payload = { ...secondWake.payload, reason };
  if (reason === null) delete secondWake.payload.reason;
  const extra = [];
  if (fingerprint !== null) {
    const fp = real.find((r) => r.kind === 'session.fingerprint');
    extra.push({ ...fp, id: `${fp.id}-resume`, at: new Date(t(firstStart) + by - fingerprint).toISOString(), payload: { ...fp.payload, start: 'resume' } });
  }
  return { rows: [...real, ...second, ...extra], secondWake, gapEnd: new Date(t(firstStart) + by).toISOString() };
}

const sums = (s) => s.workingMs + Object.values(s.waitingMs).reduce((a, b) => a + b, 0) + s.unknownMs;

test('the real session alone: working, plus start-up before the first wake, sums to wall-clock', () => {
  const { sessions } = time(real);
  const [s] = Object.values(sessions);
  assert.equal(sums(s), s.wallMs);
  assert.ok(s.workingMs > 0);
  assert.equal(s.gaps.length, 1);
  assert.equal(s.gaps[0].label, 'rebuild');
});

test('a 10-minute idle gap ended by a person wake is waiting on the person, never working', () => {
  const { rows, secondWake, gapEnd } = withGap({ reason: 'mention' });
  const [s] = Object.values(time(rows).sessions);
  const gap = s.gaps.find((g) => g.from === alone.to);
  assert.deepEqual([gap.to, gap.ms, gap.label, gap.reason, gap.inputs], [gapEnd, TEN_MIN, 'person', 'mention', [secondWake.id]]);
  assert.equal(s.waitingMs.person, TEN_MIN);
  assert.equal(s.workingMs, 2 * alone.workingMs);
  assert.equal(sums(s), s.wallMs);
});

test('each wake reason picks its waiting kind; a wake with no reason makes the gap unknown', () => {
  for (const [reason, label] of [['external-event', 'ci'], ['decision-chosen', 'person'], ['spawn', 'wake'], ['task-notification', 'wake'], [null, 'unknown']]) {
    const [s] = Object.values(time(withGap({ reason }).rows).sessions);
    const gap = s.gaps.find((g) => g.ms === TEN_MIN);
    assert.equal(gap.label, label, String(reason));
    assert.equal(sums(s), s.wallMs);
    if (label === 'unknown') assert.equal(s.unknownMs, TEN_MIN);
  }
});

test('a SessionStart inside the gap splits its tail off as rebuild', () => {
  const [s] = Object.values(time(withGap({ reason: 'mention', fingerprint: 60_000 }).rows).sessions);
  assert.equal(s.waitingMs.person, TEN_MIN - 60_000);
  assert.equal(s.waitingMs.rebuild - alone.waitingMs.rebuild, 60_000);
  assert.equal(sums(s), s.wallMs);
});

test('a turn that never closed leaves the gap after it unknown, and rows read twice count once', () => {
  const { rows } = withGap({ reason: 'mention' });
  const open = rows.filter((r) => !(r.kind === 'turn.usage' && !r.id.endsWith('-2')));
  const [s] = Object.values(time([...open, ...open]).sessions);
  const gap = s.gaps.find((g) => g.ms >= TEN_MIN);
  assert.equal(gap.label, 'unknown');
  assert.equal(gap.reason, 'the turn before it never closed');
  assert.equal(sums(s), s.wallMs);
});
