// P5 Verify covers every Expect line (stage contract, lane M): the host refuses a verify result whose lines miss an
// expect line, reorder them or add one; it accepts one that grades every line, and the item moves. The rule is the
// existing restated check, by field name only: the verify invoke gives lines (context.issue.expect), and a result's
// lines must restate them one entry per line, in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, BRIEFS, builds } from './world.js';

const ISSUE2 = { url: 'https://github.com/o/r/issues/8', expect: ['math.js exports multiply', 'multiply(2, 3) is 6'] };
const g = (line, result = 'PASS') => ({ line, result, evidence: `ran it: ${result}` });

test('P5: quick-fix verify: a missing, reordered or extra line is refused; every line graded is accepted', async () => {
  const w = await makeWorld();
  try {
    await w.start('p5', 'quick-fix', { issue: ISSUE2 });
    assert.ok((await w.agent('p5', 'brief', () => BRIEFS)).accepted);
    await w.drive('p5');
    assert.ok((await w.agent('p5', 'build', builds(w, 1))).accepted);
    await w.drive('p5');
    assert.equal(w.host('p5').snapshot.value, 'verifying');
    const verdict = (lines, result) => async ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result, pr: { url: input.target.url, at: input.target.at }, issue: input.issue, lines };
    };
    const [a, b] = ISSUE2.expect;
    const missing = await w.agent('p5', 'verify', verdict([g(a)], 'PASS'), 'ag-v');
    assert.equal(missing.refused?.rule, 'restated');
    assert.match(missing.refused.reason, /result\.lines does not restate the input's lines/);
    const reordered = await w.agent('p5', 'verify', verdict([g(b), g(a)], 'PASS'), 'ag-v');
    assert.equal(reordered.refused?.rule, 'restated');
    const extra = await w.agent('p5', 'verify', verdict([g(a), g(b), g('also has docs', 'FAIL')], 'FAIL'), 'ag-v');
    assert.equal(extra.refused?.rule, 'restated', 'a line not in expect is refused');
    const none = await w.agent('p5', 'verify', async ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result: 'PASS', pr: { url: input.target.url, at: input.target.at }, issue: input.issue, report: 'all good' };
    }, 'ag-v');
    assert.equal(none.refused?.rule, 'schema', 'a verdict with no lines does not match the schema');
    await w.drive('p5');
    assert.equal(w.host('p5').snapshot.value, 'verifying', 'no refused verdict counts');
    assert.equal(w.host('p5').snapshot.context.verdict, null);

    const ok = await w.agent('p5', 'verify', verdict([g(a, 'FAIL'), g(b, 'FAIL')], 'FAIL'), 'ag-v');
    assert.ok(ok.accepted, JSON.stringify(ok));
    await w.drive('p5');
    const h = w.host('p5');
    assert.equal(h.snapshot.value, 'building', 'the FAIL verdict sends the item back to build');
    assert.deepEqual(h.snapshot.context.verdict.lines.map((l) => [l.line, l.result]), [[a, 'FAIL'], [b, 'FAIL']]);
    const refusals = w.rows('p5').filter((r) => r.kind === 'refusal' && r.payload.actor === 'verify');
    assert.deepEqual(refusals.map((r) => r.payload.rule), ['restated', 'restated', 'restated', 'schema'], 'every refusal is journalled');
  } finally {
    await w.close();
  }
});

test('P5: an all-PASS verdict covering every line is accepted and reaches the merge question', async () => {
  const w = await makeWorld();
  try {
    await w.start('p5b', 'quick-fix', { issue: ISSUE2 });
    assert.ok((await w.agent('p5b', 'brief', () => BRIEFS)).accepted);
    await w.drive('p5b');
    assert.ok((await w.agent('p5b', 'build', builds(w, 1))).accepted);
    await w.drive('p5b');
    const ok = await w.agent('p5b', 'verify', async ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result: 'PASS', pr: { url: input.target.url, at: input.target.at }, issue: input.issue, lines: input.issue.expect.map((l) => g(l)) };
    });
    assert.ok(ok.accepted);
    await w.drive('p5b');
    assert.equal(w.host('p5b').snapshot.value, 'awaitingMerge');
  } finally {
    await w.close();
  }
});

test('P5: research verify is held to the same rule', async () => {
  const PAGE = 'https://example.org/g';
  const w = await makeWorld({ pages: { [PAGE]: 'Ganymede is the largest' } });
  try {
    await w.start('p5r', 'research', { issue: ISSUE2 });
    assert.ok((await w.agent('p5r', 'brief', () => ({ questions: ['a', 'b', 'c'], researcher: 'R', writer: 'W', verifier: 'V' }))).accepted);
    await w.drive('p5r');
    for (const q of ['q1', 'q2', 'q3']) assert.ok((await w.agent('p5r', q, () => ({ text: 'G', sources: [{ url: PAGE, at: 'Ganymede' }] }))).accepted);
    await w.drive('p5r');
    assert.ok((await w.agent('p5r', 'write', () => ({ text: 'G', sources: [{ url: PAGE, at: 'Ganymede' }] }))).accepted);
    await w.drive('p5r');
    const [a, b] = ISSUE2.expect;
    const short = await w.agent('p5r', 'verify', ({ input }) => ({ result: 'PASS', issue: input.issue, lines: [g(a)], sources: input.draft.sources }), 'ag-rv');
    assert.equal(short.refused?.rule, 'restated');
    assert.ok((await w.agent('p5r', 'verify', ({ input }) => ({ result: 'PASS', issue: input.issue, lines: [g(a), g(b)], sources: input.draft.sources }), 'ag-rv')).accepted);
  } finally {
    await w.close();
  }
});

test('P5 (round 2): a verifier that copies host-stamped fields (key, fetch, green) into its pr is refused, not silently cleaned', async () => {
  const w = await makeWorld();
  try {
    await w.start('p5s', 'quick-fix', { issue: ISSUE2 });
    assert.ok((await w.agent('p5s', 'brief', () => BRIEFS)).accepted);
    await w.drive('p5s');
    assert.ok((await w.agent('p5s', 'build', builds(w, 1))).accepted);
    await w.drive('p5s');
    const run = w.openRun('p5s', 'verify');
    assert.equal(run.input.target.fetch, 'pull/1/head', 'the host stamped the PR head refspec the verifier fetches');
    const copied = await w.agent('p5s', 'verify', async ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result: 'PASS', pr: input.target, issue: input.issue, lines: input.lines.map((l) => g(l)) };
    }, 'ag-v');
    assert.equal(copied.refused?.rule, 'reserved');
    assert.match(copied.refused.reason, /sets key, fetch, green/);
  } finally {
    await w.close();
  }
});
