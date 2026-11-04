// P5 (stage-contract pack): verify returns one result per Expect line. The host (accept) refuses a verify result that
// leaves any Expect line uncovered, adds or repeats one, or whose overall result disagrees with its lines; one with
// every line is accepted and moves the item on. Quick-fix and research, through the real hooks and accept().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, BRIEFS, builds } from './world.js';

const ISSUE2 = { url: 'https://github.com/o/r/issues/8', expect: ['a works', 'b works'] };
const PAGE = 'https://example.org/p';
const entry = (line, result = 'PASS') => ({ line, result, evidence: `ran the check for ${line}` });

test('P5: quick-fix verify: a missing, extra or repeated line, or a PASS over a FAIL line, is refused as covers; every line is accepted', async () => {
  const w = await makeWorld();
  try {
    await w.start('p5', 'quick-fix', { issue: ISSUE2 });
    assert.ok((await w.agent('p5', 'brief', () => BRIEFS)).accepted);
    await w.drive('p5');
    assert.ok((await w.agent('p5', 'build', builds(w, 1))).accepted);
    await w.drive('p5');
    assert.equal(w.host('p5').snapshot.value, 'verifying');
    const verdict = (lines, result = 'PASS') => async ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result, pr: { url: input.target.url, at: input.target.at }, issue: input.issue, lines };
    };
    const refusals = [
      [[entry('a works')], /result\.lines lacks "b works"/],
      [[entry('a works'), entry('b works'), entry('c')], /result\.lines repeats or adds "c"/],
      [[entry('a works'), entry('b works'), entry('a works')], /result\.lines repeats or adds "a works"/],
      [[entry('a works'), entry('b works', 'FAIL')], /result\.result disagrees with result\.lines/]
    ];
    for (const [lines, why] of refusals) {
      const got = await w.agent('p5', 'verify', verdict(lines), 'ag-v');
      assert.equal(got.refused?.rule, 'covers', JSON.stringify(got));
      assert.match(got.refused.reason, why);
      await w.drive('p5');
      assert.equal(w.host('p5').snapshot.value, 'verifying', 'a refused verdict does not count');
    }
    const ok = await w.agent('p5', 'verify', verdict([entry('a works'), entry('b works')]), 'ag-v');
    assert.ok(ok.accepted, JSON.stringify(ok));
    await w.drive('p5');
    assert.equal(w.host('p5').snapshot.value, 'awaitingMerge');
    assert.deepEqual(w.host('p5').snapshot.context.verdict.lines.map((e) => e.line), ISSUE2.expect);
    const covers = w.rows('p5').filter((r) => r.kind === 'refusal' && r.payload.rule === 'covers');
    assert.equal(covers.length, 4, 'each refusal is journalled');
  } finally {
    await w.close();
  }
});

test('P5: research verify: a result missing an Expect line is refused as covers; one with every line is accepted', async () => {
  const w = await makeWorld({ pages: { [PAGE]: 'a quote here' } });
  try {
    await w.start('p5r', 'research', { issue: ISSUE2 });
    assert.ok((await w.agent('p5r', 'brief', () => ({ questions: ['a', 'b', 'c'], researcher: 'R', writer: 'W', verifier: 'V' }))).accepted);
    await w.drive('p5r');
    for (const q of ['q1', 'q2', 'q3']) assert.ok((await w.agent('p5r', q, () => ({ text: 't', sources: [{ url: PAGE, at: 'a quote' }] }))).accepted);
    await w.drive('p5r');
    assert.ok((await w.agent('p5r', 'write', () => ({ text: 't', sources: [{ url: PAGE, at: 'a quote' }] }))).accepted);
    await w.drive('p5r');
    assert.equal(w.host('p5r').snapshot.value, 'verifying');
    const short = await w.agent('p5r', 'verify', ({ input }) => ({ result: 'PASS', issue: input.issue, lines: [entry('a works')], sources: [] }), 'ag-rv');
    assert.equal(short.refused?.rule, 'covers');
    assert.match(short.refused.reason, /lacks "b works"/);
    const full = await w.agent('p5r', 'verify', ({ input }) => ({ result: 'PASS', issue: input.issue, lines: input.issue.expect.map((l) => entry(l)), sources: input.draft.sources }), 'ag-rv');
    assert.ok(full.accepted, JSON.stringify(full));
    await w.drive('p5r');
    assert.equal(w.host('p5r').snapshot.value, 'awaitingPublish');
  } finally {
    await w.close();
  }
});
