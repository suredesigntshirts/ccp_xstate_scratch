// Q5 verifier misreports: the verifier returns PASS naming the right sha, but its worktree is at another commit; the
// verdict must not count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWorld, offer, startEvent, ISSUE, briefReturns, builderReturns, verifierReturns, deliver, wake, checkSuite, git, openRun } from './world.js';

test('Q5: a PASS naming A from a worktree at C counts for C, so the item does not reach a merge card', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w);
    const b = await builderReturns(w);
    await deliver(w);
    const A = b.head;
    await wake(w, checkSuite(A));
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });

    let C = null;
    const v = await verifierReturns(w, {
      extra: { sha: A },
      before: (worktree, agent) => {
        // The prompt told it what it judges and that HEAD is measured.
        assert.match(agent.context, new RegExp(`Your worktree is checked out at ${A}, the commit you are judging`));
        assert.match(agent.context, /the host reads your worktree's HEAD, and your verdict counts only for that commit/);
        assert.equal(git(worktree, 'rev-parse', 'HEAD'), A, 'the host materialized the subject');
        git(worktree, 'checkout', '-q', '--detach', 'origin/main');
        C = git(worktree, 'rev-parse', 'HEAD');
      }
    });
    assert.notEqual(C, A);
    assert.ok(v.got.accepted, JSON.stringify(v.got));
    await deliver(w);
    const { verdict } = w.host.snapshot.context;
    assert.equal(verdict.result, 'PASS');
    assert.equal(verdict.sha, A, 'the verifier claimed A');
    assert.equal(verdict.attested.subject, C, 'the host measured C');
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.equal(w.plat.cards.length, 1);
    assert.doesNotMatch(w.plat.cards[0].question, /Merge/, 'the only card is the replan card, not a merge card');
    assert.deepEqual(w.plat.cards[0].choices, ['replan', 'drop']);
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});

test('Q5: a verifier result that carries its own attested field is refused', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w);
    const b = await builderReturns(w);
    await deliver(w);
    const v = await verifierReturns(w, { extra: { attested: { run: 'x', digest: 'f'.repeat(64), subject: b.head } } });
    assert.deepEqual(v.got.refused.rule, 'attested-reserved');
    assert.ok(openRun(w.host, 'verify'), 'the run is still open for a real result');
  } finally {
    await w.close();
  }
});
