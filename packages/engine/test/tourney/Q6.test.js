// Q6 late push from a dead attempt: after a failure-driven replan, attempt 1's builder pushes; it must not affect
// attempt 2's gates or merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemWorld, offer, startEvent, ISSUE, briefReturns, builderReturns, verifierReturns, deliver, wake, checkSuite, checkRun, synchronize, tap, writtenAnswer, git, agentOf } from './world.js';

test('Q6: attempt 1\'s late push, red check and late return do not touch attempt 2, which merges its own PR', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w);
    const a1 = await builderReturns(w);
    await deliver(w);
    await verifierReturns(w, { result: 'FAIL' });
    await deliver(w);
    assert.equal(w.host.snapshot.value, 'building');
    const b1 = await builderReturns(w);
    await deliver(w);
    await verifierReturns(w, { result: 'FAIL' });
    await deliver(w);
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.equal(a1.number, 1);
    assert.equal(b1.number, 1);
    const B = b1.head;

    await writtenAnswer(w, { choice: 'replan', why: 'why1 why2 why3 why4 why5' });
    assert.equal(w.host.snapshot.value, 'briefing');
    assert.equal(w.host.snapshot.context.attempt, 2);
    await briefReturns(w);
    assert.equal(w.host.snapshot.value, 'building');

    // Attempt 2's builder first claims attempt 1's PR: attest refuses it (lane).
    const pr1 = { pr: { url: 'https://github.com/o/r/pull/1', headSha: w.gh.headOf(1) } };
    const ag2 = agentOf(w, 'build');
    const wrong = await ag2.ret(pr1);
    assert.equal(wrong.refused?.rule, 'lane', JSON.stringify(wrong));
    // ... then opens its own PR from ccp/it-1/2.
    const c = await builderReturns(w, { agent: ag2 });
    assert.ok(c.got.accepted, JSON.stringify(c.got));
    assert.equal(c.number, 2);
    await deliver(w);
    const C = c.head;
    assert.equal(w.host.snapshot.context.pr.ref, 'o/r#2');
    assert.equal(w.host.snapshot.context.pr.branch, 'ccp/it-1/2');
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });

    // Attempt 1's builder, still alive, pushes to its lane; GitHub reports the push and a red check on #1.
    const dead = b1.agent.run.worktree;
    writeFileSync(join(dead, 'late.txt'), 'late\n');
    git(dead, 'add', '.');
    git(dead, 'commit', '-q', '-m', 'late');
    git(dead, 'push', '-q', 'origin', 'HEAD:refs/heads/ccp/it-1/1');
    const X = git(dead, 'rev-parse', 'HEAD');
    const results = [...await wake(w, synchronize(X, 'o/r#1')), ...await wake(w, checkRun(B, 'o/r#1'))];
    assert.deepEqual(results.map((r) => r.outcome), ['refused', 'refused']);
    // And its late return is refused: its run already returned.
    const late = await b1.agent.ret({ pr: { url: 'https://github.com/o/r/pull/1', headSha: X } });
    assert.equal(late.refused?.rule, 'already-returned');
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });
    assert.equal(w.host.snapshot.context.pr.ref, 'o/r#2');
    assert.equal(w.host.snapshot.context.pr.head, C);

    await verifierReturns(w);
    await deliver(w);
    await wake(w, checkSuite(C, 'o/r#2'));
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    await tap(w, 0);
    assert.equal(w.host.snapshot.value, 'done');
    assert.deepEqual(w.gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 2, sha: C }]);
    assert.equal(w.gh.prs[1].merged, false);
  } finally {
    await w.close();
  }
});
