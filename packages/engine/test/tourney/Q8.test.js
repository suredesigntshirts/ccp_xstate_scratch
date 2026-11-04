// Q8 Workflow changes in flight: the workflow file changes while an item waits for approval; the item finishes on the
// rules it started with and its journal still replays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, makeEffects, toJudging, agentReturns, wake, tap, restore, loadWorkflow, transitions, RELEASE } from './world.js';
import { replay } from '../../src/index.js';

test('Q8: an item waiting for approval finishes on its pinned workflow after the file changes, and replays', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const v1 = loadWorkflow('quick-fix');
    const { host, effects } = hostFor({ root, repo, gh, plat, spec: v1 });
    const A = repo.commit('A');
    await toJudging(host, { gh, effects, head: A });
    await agentReturns(host, 'verify', { result: 'PASS', report: 'ok' }, { checkout: A, gh, effects });
    gh.green(A);
    await wake(host, { gh, effects });
    assert.equal(host.snapshot.value, 'asking');

    // The workflow file changes in flight: merging now needs a guard that never holds, and the card text changed.
    const v2 = structuredClone(v1);
    v2.meta.guards.secondApproval = ['context.secondApproval'];
    v2.states.merging.meta.needs.push('secondApproval');
    v2.states.asking.invoke.input.question = { value: 'New wording' };

    const again = restore({ root, item: 'it-1', spec: v2, session: 'owner', release: RELEASE });
    assert.deepEqual(again.spec, v1, 'restore loads the workflow the item was pinned to, not the file it was handed');
    assert.equal(again.snapshot.value, 'asking');
    const effects2 = makeEffects(again, { repo, gh, plat });
    await tap(again, { effects: effects2, index: 0 });
    assert.equal(again.snapshot.value, 'done', 'finished on v1 rules (v2 would never let it merge)');
    assert.deepEqual(gh.merges, [{ number: 1, sha: A }]);

    // The whole journal replays: restore checks every applied row's hash under the pinned spec.
    const third = restore({ root, item: 'it-1', spec: v2, session: 'owner', release: RELEASE });
    assert.equal(third.snapshot.value, 'done');
    // And under v2 it would not: the rules did change.
    const entries = transitions(root).filter((r) => r.payload.outcome === 'applied').map((r) => ({ seq: r.payload.seq, event: r.payload.event, hash: r.payload.hash })).sort((a, b) => a.seq - b.seq);
    assert.equal(replay(v1, entries).value, 'done');
    assert.throws(() => replay(v2, entries), /the workflow changed/);
  } finally {
    await gh.close();
  }
});
