// Q5 verifier misreports: the verifier returns PASS naming the right sha, but its worktree is at another commit; the
// verdict must not count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeWorld, ISSUE, BRIEFS, builds, verifies, resultsOf, graded } from './world.js';

test('Q5: PASS naming the PR head from a worktree at another commit is refused; the item stays verifying; the honest PASS counts', async () => {
  const w = await makeWorld();
  try {
    await w.start('q5', 'quick-fix', { issue: ISSUE });
    assert.ok((await w.agent('q5', 'brief', () => BRIEFS)).accepted);
    await w.drive('q5');
    assert.ok((await w.agent('q5', 'build', builds(w, 1))).accepted);
    await w.drive('q5');
    assert.equal(w.host('q5').snapshot.value, 'verifying');
    const A = w.gh.state[1].head;
    let X = null;
    const lie = await w.agent('q5', 'verify', async ({ input, worktree }) => {
      X = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      return { result: 'PASS', pr: { url: input.target.url, at: A }, issue: input.issue, lines: graded(input) };
    }, 'ag-verify');
    assert.notEqual(X, A, 'the verifier\'s worktree is at another commit');
    assert.equal(lie.refused?.rule, 'ref');
    assert.match(lie.refused.reason, new RegExp(`your worktree is at ${X}, not ${A}`));
    const h = w.host('q5');
    assert.deepEqual(resultsOf(h), [], 'nothing reaches the item');
    await w.drive('q5');
    assert.equal(w.host('q5').snapshot.value, 'verifying');
    assert.equal(w.host('q5').snapshot.context.verdict, null);
    assert.equal(w.rows('q5').filter((r) => r.kind === 'refusal' && r.payload.rule === 'ref').length, 1, 'the refusal is journalled');
    // Control: the same verifier checks out A and returns again.
    const honest = await w.agent('q5', 'verify', verifies(w, 'PASS'), 'ag-verify');
    assert.ok(honest.accepted, JSON.stringify(honest));
    await w.drive('q5');
    assert.equal(w.host('q5').snapshot.value, 'awaitingMerge');
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});
