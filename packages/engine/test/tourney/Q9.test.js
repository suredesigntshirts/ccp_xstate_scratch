// Q9 expect edited on GitHub: the issue's acceptance lines change mid-build (could be an agent); grading must not
// change without the person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, ISSUE, BRIEFS, builds } from './world.js';

const edited = (expect) => `<wake reason="external-event" current-time="2026-10-30T18:00:00Z">\n  <event source="github" kind="issues.edited" from="system" trust="relay">\n    ${JSON.stringify({ issue: 'o/r#7', expect })}\n  </event>\n</wake>`;

test('Q9: an issue edit mid-build is refused; the verifier grades the original lines and must restate them exactly', async () => {
  const w = await makeWorld();
  try {
    await w.start('q9', 'quick-fix', { issue: ISSUE });
    assert.ok((await w.agent('q9', 'brief', () => BRIEFS)).accepted);
    await w.drive('q9');
    assert.equal(w.host('q9').snapshot.value, 'building');
    const EDITED = ['math.js exports multiply', 'nothing else needs testing'];
    const got = await w.drive('q9', edited(EDITED));
    assert.equal(got.length, 1);
    assert.equal(got[0].outcome, 'refused');
    assert.match(got[0].row.payload.reason, /github\.issues\.edited is not an event quick-fix@[0-9a-f]+ takes/);
    assert.ok((await w.agent('q9', 'build', builds(w, 1))).accepted);
    await w.drive('q9');
    assert.equal(w.host('q9').snapshot.value, 'verifying');
    const run = w.openRun('q9', 'verify');
    assert.deepEqual(run.input.issue, ISSUE, 'the verifier is given the original lines');
    // A verifier that grades against the edited issue (as GitHub now shows it) is refused.
    const drift = await w.agent('q9', 'verify', async ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result: 'PASS', pr: { url: input.target.url, at: input.target.at }, issue: { ...ISSUE, expect: EDITED }, report: 'r' };
    }, 'ag-v');
    assert.equal(drift.refused?.rule, 'restated');
    await w.drive('q9');
    assert.equal(w.host('q9').snapshot.value, 'verifying');
    assert.equal(w.host('q9').snapshot.context.verdict, null, 'the drifted verdict does not count');
    const honest = await w.agent('q9', 'verify', async ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result: 'PASS', pr: { url: input.target.url, at: input.target.at }, issue: input.issue, report: 'r' };
    }, 'ag-v');
    assert.ok(honest.accepted);
    await w.drive('q9');
    const h = w.host('q9');
    assert.equal(h.snapshot.value, 'awaitingMerge');
    assert.deepEqual(h.snapshot.context.verdict.issue.expect, ISSUE.expect);
    assert.deepEqual(h.snapshot.context.issue, ISSUE, 'context still grades the original lines');
  } finally {
    await w.close();
  }
});
