// Q8 workflow changes in flight: the workflow file changes while an item waits for approval; the item finishes on
// the rules it started with and its journal still replays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, agents, fakeGitHub, fresh, loadWorkflow, offer, open, platform, prOf, start, suite, tap, transitions, world } from './world-b.js';
import { specHash } from '../../src/host.js';

const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
const outputs = () => ({ brief: [{ builder: 'b', verifier: 'v' }], build: [{ pr: prOf(1, A) }], verify: [{ result: 'PASS', sha: A, ciChanged: false, report: 'ok' }] });

test('Q8: an item started on v1 finishes on v1 after the file becomes v2; its journal replays; a new item runs v2', async () => {
  const gh = await fakeGitHub({ 1: { head: A }, 2: { head: A } });
  try {
    const plat = platform();
    const root = fresh('q8');
    const v1 = loadWorkflow('quick-fix');
    let host = open(root, v1);
    const fx = world({ gh, plat, actors: agents(outputs()).byActor });
    await offer(host, [start({ issue: ISSUE })], fx);
    await offer(host, suite(host, A), fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');
    const seq0 = transitions(root).find((r) => r.payload.seq === 0);
    assert.equal(seq0.payload.spec, specHash(v1), 'the first row pins the workflow by hash');
    const before = host.snapshot.context;

    // The workflow file changes: another question, merging removed, approve now leads to dropped.
    const v2 = structuredClone(v1);
    v2.states.awaitingMerge.invoke.input.question.value = 'CHANGED';
    delete v2.states.merging;
    for (const s of ['awaitingMerge', 'awaitingCiApproval']) {
      v2.states[s].invoke.onDone[0].target = 'dropped';
      v2.states[s].invoke.onDone[0].actions = [];
    }

    host = open(root, v2); // restore as the next wake would, offered the new file
    assert.deepEqual(host.spec, v1, 'the restored item runs its pinned v1');
    assert.deepEqual(host.offered, v2);
    assert.equal(host.snapshot.value, 'awaitingMerge', 'the journal replays (hashes match) under v1');
    assert.deepEqual(host.snapshot.context, before);

    await offer(host, tap(host, 0), world({ gh, plat, actors: agents({}).byActor }));
    assert.equal(host.snapshot.value, 'done', 'finished on v1\'s rules');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);
    assert.equal(open(root, v2).snapshot.value, 'done', 'the whole journal still replays');

    // A new item started now runs v2.
    const plat2 = platform();
    const fresh2 = open(root, v2, { item: 'it-2' });
    const o = outputs();
    o.build = [{ pr: prOf(2, A) }];
    const fx2 = world({ gh, plat: plat2, actors: agents(o).byActor });
    await offer(fresh2, [start({ issue: ISSUE })], fx2);
    await offer(fresh2, suite(fresh2, A, 7), fx2);
    assert.equal(fresh2.snapshot.value, 'awaitingMerge');
    assert.equal(plat2.cards[0].question, 'CHANGED');
    await offer(fresh2, tap(fresh2, 0), fx2);
    assert.equal(fresh2.snapshot.value, 'dropped', 'v2\'s rules');
  } finally {
    await gh.close();
  }
});
