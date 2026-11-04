// Q3 red CI: a required check fails on the head; with a build left the item rebuilds carrying the failing check as a
// typed failure; with none left it goes to replanning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, agents, fakeGitHub, fresh, loadWorkflow, offer, open, platform, prOf, red, start, world } from './world-b.js';

const spec = loadWorkflow('quick-fix');
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };

test('Q3: red CI on the head rebuilds with a typed check failure, and with no build left goes to replanning', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const plat = platform();
    const host = open(fresh('q3'), spec);
    const a = agents({ brief: [{ builder: 'b', verifier: 'v' }], build: [{ pr: prOf(1, A) }, null], verify: [null, null] });
    const fx = world({ gh, plat, actors: a.byActor });
    await offer(host, [start({ issue: ISSUE })], fx);
    assert.equal(host.snapshot.value, 'verifying');

    // A red check on another head is not about this PR's head.
    const [other] = await offer(host, red(host, B, 'lint'), fx);
    assert.equal(other.outcome, 'refused');

    await offer(host, red(host, A), fx);
    assert.equal(host.snapshot.value, 'building', 'one build left: rebuild');
    const rebuild = a.started.filter((e) => e.actor === 'build').at(-1);
    assert.equal(rebuild.input.failure.kind, 'check');
    assert.equal(rebuild.input.failure.check, 'test');
    assert.equal(rebuild.input.failure.conclusion, 'failure');
    assert.equal(rebuild.input.failure.sha, A);
    assert.match(rebuild.input.failure.url, /actions\/runs/);

    gh.push(1, B);
    await offer(host, [{ event: { type: 'xstate.done.actor.build', output: { pr: prOf(1, B) } }, run: rebuild.id, source: { system: 'harness', ref: 'b2' } }], fx);
    assert.equal(host.snapshot.value, 'verifying');
    assert.equal(host.snapshot.context.builds, 2);
    await offer(host, red(host, B), fx);
    assert.equal(host.snapshot.value, 'replanning', 'no build left: replanning');
    assert.equal(host.snapshot.context.failure.kind, 'check');
    assert.equal(a.started.filter((e) => e.actor === 'build').length, 2, 'no third build');
    assert.equal(gh.merges.length, 0);
    assert.deepEqual(plat.cards.at(-1).choices, ['replan', 'drop']);
  } finally {
    await gh.close();
  }
});
