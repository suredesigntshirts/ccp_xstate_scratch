// R1 research: three parallel sub-questions, one researcher errors. The join does not hang; the report is verified
// against sources the host itself checked; it is published only after approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, tapWake, taskWake, pending, graded } from './world.js';

const Q = { url: 'https://github.com/o/r/issues/11', expect: ['names the three largest moons of Jupiter', 'cites a source for each'] };
const PAGES = {
  'https://example.org/ganymede': '<p>Ganymede is   the largest moon in the Solar System.</p>',
  'https://example.org/callisto': '<p>Callisto is the second-largest moon of Jupiter.</p>'
};
const PLAN = { questions: ['Which is largest?', 'Which is second?', 'Which is third?'], researcher: 'research one question', writer: 'write the report', verifier: 'verify independently' };
const src = (url, at) => ({ url, at });

test('R1: one researcher fails, the join completes, sources are host-checked, and publishing waits for the tap', async () => {
  const w = await makeWorld({ pages: PAGES });
  let taps = 0;
  try {
    await w.start('r1', 'research', { issue: Q });
    assert.ok((await w.agent('r1', 'brief', () => PLAN)).accepted);
    await w.drive('r1');
    assert.equal(w.host('r1').snapshot.value, 'researching');
    const runs = pending(w.host('r1')).runs;
    assert.deepEqual(runs.map((r) => r.invoke).sort(), ['q1', 'q2', 'q3'], 'three researchers at once');

    assert.ok((await w.agent('r1', 'q1', () => ({ text: 'Ganymede', sources: [src('https://example.org/ganymede', 'Ganymede is the largest moon')] }))).accepted);
    await w.drive('r1');
    assert.equal(w.host('r1').snapshot.value, 'researching');
    // q3's worker fails: the platform's task notification.
    const q3 = runs.find((r) => r.invoke === 'q3');
    await w.drive('r1', taskWake(q3.id, 'failed'));
    assert.equal(w.host('r1').snapshot.value, 'researching', 'still waiting on q2');
    assert.ok((await w.agent('r1', 'q2', () => ({ text: 'Callisto', sources: [src('https://example.org/callisto', 'second-largest moon of Jupiter')] }))).accepted);
    await w.drive('r1');
    let h = w.host('r1');
    assert.equal(h.snapshot.value, 'writing', 'the join completed with one failed child');
    assert.equal(h.snapshot.context.answers.q3.error, 'the worker failed');
    assert.equal(h.snapshot.context.answers.q1.text, 'Ganymede');

    // The writer cites a quote the page does not have: refused by the host's own fetch.
    const bad = await w.agent('r1', 'write', () => ({ text: 'Ganymede, Callisto, Io', sources: [src('https://example.org/ganymede', 'Ganymede is the largest moon'), src('https://example.org/io', 'Io is third')] }), 'ag-writer');
    assert.equal(bad.refused?.rule, 'ref');
    assert.match(bad.refused.reason, /example\.org\/io does not contain the quoted text/);
    const good = await w.agent('r1', 'write', () => ({ text: 'Ganymede, then Callisto; the third is unanswered.', sources: [src('https://example.org/ganymede', 'Ganymede is the largest moon'), src('https://example.org/callisto', 'second-largest moon of Jupiter')] }), 'ag-writer');
    assert.ok(good.accepted);
    await w.drive('r1');
    assert.equal(w.host('r1').snapshot.value, 'verifying');
    const vin = w.openRun('r1', 'verify').input;
    assert.deepEqual(vin.issue, Q);
    // A verifier citing an unchecked source is refused too; the honest one, restating issue, is accepted.
    assert.equal((await w.agent('r1', 'verify', ({ input }) => ({ result: 'PASS', issue: input.issue, lines: graded(input), sources: [src('https://example.org/nowhere', 'x')] }), 'ag-v')).refused?.rule, 'ref');
    assert.ok((await w.agent('r1', 'verify', ({ input }) => ({ result: 'PASS', issue: input.issue, lines: graded(input), sources: input.draft.sources }), 'ag-v')).accepted);
    await w.drive('r1');
    assert.equal(w.host('r1').snapshot.value, 'awaitingPublish');
    assert.deepEqual(w.plat.posts, [], 'nothing published before the approval');

    await w.drive('r1', tapWake(w.cardOf('r1'), 0)); taps++;
    h = w.host('r1');
    assert.equal(h.snapshot.value, 'done');
    assert.equal(w.plat.posts.length, 1);
    assert.equal(w.plat.posts[0].text, 'Ganymede, then Callisto; the third is unanswered.');
    assert.equal(h.snapshot.context.decision.choice, 'approve');
    assert.equal(taps, 1);
  } finally {
    await w.close();
  }
});

test('R1: a rejected report is not published', async () => {
  const w = await makeWorld({ pages: PAGES });
  try {
    await w.start('r1', 'research', { issue: Q });
    assert.ok((await w.agent('r1', 'brief', () => PLAN)).accepted);
    await w.drive('r1');
    for (const q of ['q1', 'q2', 'q3']) assert.ok((await w.agent('r1', q, () => ({ text: 'G', sources: [src('https://example.org/ganymede', 'Ganymede')] }))).accepted);
    await w.drive('r1');
    assert.ok((await w.agent('r1', 'write', () => ({ text: 'G', sources: [src('https://example.org/ganymede', 'Ganymede')] }))).accepted);
    await w.drive('r1');
    assert.ok((await w.agent('r1', 'verify', ({ input }) => ({ result: 'PASS', issue: input.issue, lines: graded(input), sources: input.draft.sources }))).accepted);
    await w.drive('r1');
    await w.drive('r1', tapWake(w.cardOf('r1'), 1));
    assert.equal(w.host('r1').snapshot.value, 'replanning');
    assert.deepEqual(w.plat.posts, []);
  } finally {
    await w.close();
  }
});

// Round 2: `inc` is gone; the draft bound is a two-field shift register. Two FAILs end in replanning, not a third draft.
test('R1 (round 2, no inc): drafts are bounded at two; a second FAIL replans', async () => {
  const w = await makeWorld({ pages: PAGES });
  try {
    await w.start('r1b', 'research', { issue: Q });
    assert.ok((await w.agent('r1b', 'brief', () => PLAN)).accepted);
    await w.drive('r1b');
    for (const q of ['q1', 'q2', 'q3']) assert.ok((await w.agent('r1b', q, () => ({ text: 'G', sources: [src('https://example.org/ganymede', 'Ganymede')] }))).accepted);
    await w.drive('r1b');
    for (let i = 0; i < 2; i++) {
      assert.equal(w.host('r1b').snapshot.value, 'writing');
      assert.ok((await w.agent('r1b', 'write', () => ({ text: 'G', sources: [src('https://example.org/ganymede', 'Ganymede')] }), `ag-w${i}`)).accepted);
      await w.drive('r1b');
      assert.ok((await w.agent('r1b', 'verify', ({ input }) => ({ result: 'FAIL', issue: input.issue, lines: graded(input, 'FAIL'), sources: [] }), `ag-v${i}`)).accepted);
      await w.drive('r1b');
    }
    const h = w.host('r1b');
    assert.equal(h.snapshot.value, 'replanning');
    assert.deepEqual([h.snapshot.context.drafted, h.snapshot.context.redrafted], [true, true]);
    assert.equal(w.rows('r1b').filter((r) => r.kind === 'engine.effect' && r.payload.type === 'run' && r.payload.effect.endsWith('.write') && r.payload.phase === 'start').length, 2);
    assert.deepEqual(w.plat.posts, []);
  } finally {
    await w.close();
  }
});
