// F2 The parent is restored on another host mid-slice: no slice is started twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fresh, gitRepo, fakeGitHub, platform, agentReturns, restore, offer, makeEffects, rows, RELEASE, pending } from './world.js';
import { feature, startFeature, currentChild, childToPass, hearParent, slice, childItems, FEATURE, SPECS } from './feature-world.js';
import { itemFile } from '../../src/host.js';
import { childEvents } from '../../src/effects/index.js';

const inits = (root, item) => rows(root, item).filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'applied' && r.payload.seq === 0).length;
const startRows = (root) => rows(root, 'feat-1').filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'start');

test('F2: the parent dies mid-start and is restored on a new host: the slice child is found, not started again', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const w = { repo, gh, plat };
    const { host: parent, effects } = feature({ root, ...w });
    await startFeature(parent, effects);
    // The host dies inside the start effect, after the child item exists and before the effect's end is journalled.
    const dying = { ...effects, run: { ...effects.run, start: async (effect) => { await effects.run.start(effect); return new Promise(() => {}); } } };
    agentReturns(parent, 'plan', { slices: [slice(1, 'a'), slice(2, 'b')] }, { gh, effects: dying });
    const child = 'feat-1:1.slice.0';
    for (let i = 0; i < 200 && !existsSync(itemFile(root, child)); i += 1) await new Promise((ok) => setTimeout(ok, 10));
    for (let i = 0; i < 200 && inits(root, child) === 0; i += 1) await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(inits(root, child), 1);
    assert.deepEqual(startRows(root).map((r) => r.payload.phase), ['start'], 'the start effect began and never ended');

    // A new host for the same owner restores the parent from its journal and carries on.
    const again = restore({ root, item: 'feat-1', spec: FEATURE, session: 'owner', release: RELEASE });
    assert.equal(again.snapshot.value, 'slicing');
    const effects2 = makeEffects(again, { ...w, specs: SPECS, childHandlers: (c) => makeEffects(c, w) });
    await offer(again, [], effects2);
    assert.deepEqual(startRows(root).map((r) => r.payload.phase), ['start', 'done'], 'found, not restarted');
    assert.equal(inits(root, child), 1, 'slice 1 was started once');
    assert.deepEqual(childItems(root), [child]);

    // The slice finishes; the next one starts once, and hearing the same end twice changes nothing.
    const s1 = currentChild(again, w);
    await childToPass(s1, { ...w, n: 1 });
    await hearParent(again, effects2);
    const twice = await hearParent(again, effects2);
    assert.ok(twice.every((r) => r.outcome !== 'applied'));
    assert.equal(again.snapshot.context.slices.at, 1);
    const ids = childItems(root);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], child);
    assert.match(ids[1], /^feat-1:\d+\.slice\.1$/);
    for (const id of ids) assert.equal(inits(root, id), 1, `${id} started once`);
  } finally {
    await gh.close();
  }
});

test('F2: a host of another session restores the parent mid-slice and starts nothing, and its events are turned away', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const w = { repo, gh, plat };
    const { host: parent, effects } = feature({ root, ...w });
    await startFeature(parent, effects);
    await agentReturns(parent, 'plan', { slices: [slice(1, 'a'), slice(2, 'b')] }, { gh, effects });
    const s1 = currentChild(parent, w);
    await childToPass(s1, { ...w, n: 1 });
    assert.equal(s1.host.snapshot.value, 'done');

    const other = restore({ root, item: 'feat-1', spec: FEATURE, session: 'other', release: RELEASE });
    const otherEffects = makeEffects(other, { ...w, specs: SPECS, childHandlers: (c) => makeEffects(c, w) });
    const heard = await offer(other, childEvents(other, SPECS), otherEffects);
    assert.deepEqual(heard.map((r) => r.outcome), ['not-owner']);
    assert.equal(childItems(root).length, 1, 'the other host started no slice');

    await hearParent(parent, effects);
    assert.equal(parent.snapshot.context.slices.at, 1);
    // The other host, restored again, sees slice 2 open and still starts nothing.
    const other2 = restore({ root, item: 'feat-1', spec: FEATURE, session: 'other', release: RELEASE });
    await offer(other2, [], makeEffects(other2, { ...w, specs: SPECS, childHandlers: (c) => makeEffects(c, w) }));
    const ids = childItems(root);
    assert.equal(ids.length, 2);
    for (const id of ids) assert.equal(inits(root, id), 1, `${id} started once`);
    assert.equal(pending(parent).runs.filter((r) => r.actor === 'start').length, 1);
  } finally {
    await gh.close();
  }
});
