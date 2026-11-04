// F2 The parent is restored on another host mid-slice: no slice is started twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { A, world, fakeGitHub, fileExists, openRunOf, offer, transitions } from './world.js';
import { feature, planned, built, verified } from './feature-helpers.js';
import { itemFile } from '../../src/index.js';

const inits = (root, item) => transitions(root, item).filter((r) => r.payload.event.type === 'xstate.init' && r.payload.outcome === 'applied').length;
const snapshotOfFiles = (root) => Object.fromEntries(readdirSync(join(root, 'items')).filter((f) => f.endsWith('.jsonl')).map((f) => [f, statSync(join(root, 'items', f)).size]));

test('F2 the parent restored on another host mid-slice starts no slice twice; another session does nothing', async () => {
  const gh = await fakeGitHub({});
  try {
    const first = world({ gh });
    const { child } = await planned(first);
    gh.add(11, { head: A, branch: 'build/11', base: 'feature/x' });
    await built(first, child(0), 11, A, gh);
    assert.equal(first.open(child(0)).snapshot.value, 'checking', 'slice 1 is mid-flight');

    // Another host, same session (a new process: its own handlers, items effect, agents and thread).
    const second = world({ root: first.root, gh, session: 'owner' });
    for (let i = 0; i < 2; i++) {
      const parent = second.open('f-1', feature());
      assert.equal(parent.snapshot.value, 'slicing');
      await offer(parent, [], second.handlers);
      const adv = await second.advance('f-1', feature());
      assert.deepEqual(adv.inputs, [], 'the join is not complete');
    }
    assert.equal(inits(first.root, child(0)), 1, 'one start of slice 1');
    assert.ok(!fileExists(first.root, child(1)), 'slice 2 not started');
    const builds = [...first.agents.started, ...second.agents.started].filter((e) => e.actor === 'build' && e.id.startsWith(`${child(0)}:`));
    assert.equal(builds.length, 1, 'one build start for slice 1');
    assert.equal(second.agents.started.length, 0, 'the second host started no agent');

    // The items effect asked again for the same run adds no second start.
    const run = openRunOf(second.open('f-1', feature()), 'slices');
    await second.itemsHandler.start(run);
    await second.itemsHandler.find(run);
    assert.equal(inits(first.root, child(0)), 1);

    // Another session restores the parent: advance returns nothing and writes nothing.
    const other = world({ root: first.root, gh, session: 'other' });
    const before = snapshotOfFiles(first.root);
    const parentText = readFileSync(itemFile(first.root, 'f-1'), 'utf8');
    const adv = await other.advance('f-1', feature());
    assert.deepEqual(adv.inputs, []);
    await offer(other.open('f-1', feature()), [], other.handlers);
    assert.deepEqual(snapshotOfFiles(first.root), before, 'no item file changed');
    assert.equal(readFileSync(itemFile(first.root, 'f-1'), 'utf8'), parentText);
    assert.equal(other.agents.started.length, 0);

    // Slice 1 finishes; both hosts of the owner advance the parent: slice 2 starts once.
    assert.equal((await verified(first, child(0), 11, A, 'PASS', gh)).snapshot.value, 'done');
    await second.advance('f-1', feature());
    await first.advance('f-1', feature());
    await second.advance('f-1', feature());
    assert.equal(inits(first.root, child(1)), 1, 'slice 2 started once');
    const builds2 = [...first.agents.started, ...second.agents.started].filter((e) => e.actor === 'brief' && e.id.startsWith(`${child(1)}:`));
    assert.equal(builds2.length, 1, 'one brief start for slice 2');
  } finally {
    await gh.close();
  }
});
