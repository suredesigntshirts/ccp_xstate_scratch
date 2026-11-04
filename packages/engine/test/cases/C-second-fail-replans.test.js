// C-second-fail-replans (plan/cases/work-item.md): a FAIL, a rebuild and a second FAIL send the item to
// replanning, which waits for a written five whys, and no third build starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, BRIEFS, done, path, pr, run, starts, toVerifying, verdict } from '../flow.js';

const twoFails = [...toVerifying(A), done('verify', verdict('FAIL', A)), done('build', pr(B)), done('verify', verdict('FAIL', B))];

test('C-second-fail-replans: the first FAIL rebuilds, the second goes to replanning', () => {
  assert.deepEqual(path(twoFails).slice(1), ['building', 'verifying', 'building', 'verifying', 'replanning']);
  assert.equal(run(twoFails).context.builds, 2);
});

test('C-second-fail-replans: the second FAIL starts the replan question, not a build', () => {
  assert.deepEqual(starts(run(twoFails.slice(0, -1)), twoFails.at(-1)), ['ask']);
});

test('C-second-fail-replans: replan without a written why asks again and starts no build', () => {
  const replanning = run(twoFails);
  const noWhy = done('ask', { choice: 'replan', by: 'p' });
  assert.equal(run([...twoFails, noWhy]).value, 'replanning');
  assert.deepEqual(starts(replanning, noWhy), ['ask']);
});

test('C-second-fail-replans: replan with a written why briefs again with the build count reset', () => {
  const again = run([...twoFails, done('ask', { choice: 'replan', by: 'p', why: 'five whys: ...' })]);
  assert.equal(again.value, 'briefing');
  assert.deepEqual([again.context.builds, again.context.verdict, again.context.why], [0, null, 'five whys: ...']);
  assert.equal(run([...twoFails, done('ask', { choice: 'replan', by: 'p', why: 'w' }), done('brief', BRIEFS)]).value, 'building');
});

test('C-second-fail-replans: drop ends the item', () => {
  assert.equal(run([...twoFails, done('ask', { choice: 'drop', by: 'p' })]).value, 'dropped');
});
