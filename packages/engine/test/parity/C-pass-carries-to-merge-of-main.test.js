// C-pass-carries-to-merge-of-main (plan/cases/work-item.md): given a PASS on head A, when the new head B is only a
// merge of main into A, the workflow may carry the PASS to B if the workflow file says so; the default is to
// re-verify. quick-fix says nothing about carrying a PASS, so the default holds: B is verified again before any merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, cardOf, fakeGitHub, inputsOfWakeFor, offer, openRun, returned, tapWake, toAwaitingMerge, verdict, workflow } from './world.js';

const mergeOfMain = (head) => ({ event: { type: 'pr.pushed', headSha: head }, source: { system: 'github', ref: `push ${head} merge of main` } });

test('C-pass-carries-to-merge-of-main: quick-fix names no carry rule, so the default applies', () => {
  assert.doesNotMatch(JSON.stringify(workflow), /carry|mergeOfMain|merge-of-main/i);
});

test('C-pass-carries-to-merge-of-main: by default a merge of main onto a PASS is verified again, and only the new PASS merges', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { host, effects, agents } = await toAwaitingMerge({ head: A, gh });
    const oldCard = cardOf(host, openRun(host, 'ask'));
    gh.push(1, B);
    await offer(host, [mergeOfMain(B)], effects);
    assert.equal(host.snapshot.value, 'verifying');
    assert.equal(agents.started.filter((e) => e.actor === 'verify').length, 2, 'B is verified again');
    assert.equal(host.snapshot.context.verdict.sha, A, 'the PASS for A is not taken as a PASS for B');
    assert.deepEqual(inputsOfWakeFor(host, tapWake(oldCard)), []);

    await offer(host, [returned(host, 'verify', verdict('PASS', B))], effects);
    await offer(host, inputsOfWakeFor(host, tapWake(cardOf(host, openRun(host, 'ask')))), effects);
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges, [{ number: 1, sha: B }]);
  } finally {
    await gh.close();
  }
});
