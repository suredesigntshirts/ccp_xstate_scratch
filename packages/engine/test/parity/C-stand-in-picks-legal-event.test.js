// C-stand-in-picks-legal-event (plan/cases/work-item.md): a waiting state with a card under a grant; when the stand-in
// answers with an event that isn't legal in that state, it is refused. A legal answer is journalled with the grant that
// covered it. Driven through bin/host.js answer, as a stand-in session runs it, with GitHub a local server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { A, BRIEFS, agents, fakeGitHub, fresh, hostCli, offer, open, openRun, platform, pr, rows, start, toAwaitingMerge, transitions, world } from './world.js';

const GRANT = { id: 'g-away', workflow: 'quick-fix', ask: 'ask', choices: ['approve', 'reject'], repos: ['o/r'], until: '2999-01-01T00:00:00Z', granted_by: 'person', said: 'act on my behalf' };

// An item at awaitingMerge with its card up, under <harness>/journal with grants.json beside it.
async function awaiting(gh, grants = [GRANT]) {
  const harness = fresh('parity-standin');
  const root = join(harness, 'journal');
  mkdirSync(root);
  writeFileSync(join(harness, 'grants.json'), JSON.stringify({ grants }));
  const { host } = await toAwaitingMerge({ root, head: A, gh });
  return { root, host, effect: openRun(host, 'ask').id };
}
const answer = (root, gh, effect, choice) =>
  hostCli(root, ['answer', '--effect', effect, '--choice', choice, '--by', 'standin-session'], { env: { CCP_GITHUB_API: gh.api } });

test('C-stand-in-picks-legal-event: an answer that is not one of the open ask\'s choices is refused, and the item is unchanged', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { root, effect } = await awaiting(gh);
    const before = rows(root).length;
    for (const choice of ['replan', 'merge', 'drop']) {
      const out = await answer(root, gh, effect, choice);
      assert.equal(out.status, 2);
      assert.match(out.stderr, new RegExp(`refused: "${choice}" is not one of the ask's choices \\(approve, reject\\)`));
    }
    assert.equal(rows(root).length, before);
    assert.equal(open(root).snapshot.value, 'awaitingMerge');
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});

test('C-stand-in-picks-legal-event: an answer where no ask is open, or under no covering grant, is refused', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    // Verifying: no card is up, so there is nothing to answer.
    const harness = fresh('parity-standin');
    const root = join(harness, 'journal');
    writeFileSync(join(harness, 'grants.json'), JSON.stringify({ grants: [GRANT] }));
    const host = open(root);
    await offer(host, [start()], world({ actors: agents({ brief: BRIEFS, build: pr(A) }).byActor }));
    assert.equal(host.snapshot.value, 'verifying');
    const none = await answer(root, gh, 'it-1:2.ask', 'approve');
    assert.equal(none.status, 2);
    assert.match(none.stderr, /refused: it-1:2\.ask is not an open ask run of it-1/);

    // A grant that has expired covers nothing.
    const expired = await awaiting(gh, [{ ...GRANT, until: '2020-01-01T00:00:00Z' }]);
    const late = await answer(expired.root, gh, expired.effect, 'approve');
    assert.equal(late.status, 2);
    assert.match(late.stderr, /refused: no grant covers approve .*g-away: expired/);
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});

test('C-stand-in-picks-legal-event: a legal answer is journalled with the grant that covered it, and the host merges', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const { root, effect } = await awaiting(gh);
    const out = await answer(root, gh, effect, 'approve');
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).state, 'done');
    const row = transitions(root).find((r) => r.payload.run === effect && r.payload.outcome === 'applied');
    assert.equal(row.source.system, 'standin');
    assert.match(row.source.ref, /^g-away cmsg_card\d+$/);
    assert.deepEqual(row.payload.event.output, { choice: 'approve', by: 'standin-session', grant: 'g-away' });
    assert.deepEqual(gh.merges, [{ number: 1, sha: A }]);
  } finally {
    await gh.close();
  }
});
