// C-verdict-on-old-head (plan/cases/work-item.md): a PASS for commit A, when the PR's head is commit B, can't reach
// merging, and the verdict is recorded as stale. Driven through the host; GitHub is a local server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, BRIEFS, agents, fakeGitHub, fresh, offer, open, pr, returned, start, transitions, verdict, world, platform } from './world.js';

test('C-verdict-on-old-head: a PASS for A on a PR whose head is B goes to replanning, never merging, the verdict kept beside the head', async () => {
  const gh = await fakeGitHub({ 1: { head: B } });
  try {
    const root = fresh();
    const host = open(root);
    const plat = platform();
    const effects = world({ gh, plat, actors: agents({ brief: BRIEFS, build: pr(B) }).byActor });
    await offer(host, [start()], effects);
    assert.equal(host.snapshot.value, 'verifying');

    const [result] = await offer(host, [returned(host, 'verify', verdict('PASS', A))], effects);
    assert.equal(result.outcome, 'applied');
    assert.equal(host.snapshot.value, 'replanning');
    const { verdict: v, pr: p } = host.snapshot.context;
    assert.deepEqual([v.result, v.sha, p.headSha], ['PASS', A, B], 'the stale verdict is recorded with the head it does not match');
    const states = transitions(root).map((r) => r.state);
    assert.ok(!states.includes('"awaitingMerge"') && !states.includes('"merging"'), states.join(' > '));
    assert.equal(gh.merges.length, 0);
    // The only card is the replan question, not a merge question.
    assert.deepEqual(plat.cards.map((c) => c.choices), [['replan', 'drop']]);
  } finally {
    await gh.close();
  }
});

test('C-verdict-on-old-head: the same PASS at the head waits to merge (the control)', async () => {
  const root = fresh();
  const host = open(root);
  const effects = world({ actors: agents({ brief: BRIEFS, build: pr(B) }).byActor });
  await offer(host, [start()], effects);
  await offer(host, [returned(host, 'verify', verdict('PASS', B))], effects);
  assert.equal(host.snapshot.value, 'awaitingMerge');
});
