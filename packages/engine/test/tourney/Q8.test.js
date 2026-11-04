// Q8 workflow changes in flight: the workflow file changes while an item waits for approval; the item finishes on the
// rules it started with and its journal still replays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemWorld, quickFixToMerge, fresh, tap, transitionsOf, restore, RELEASE, ITEM } from './world.js';
import { pinnedWorkflow, replay, hashOf } from '../../src/index.js';

const V1 = readFileSync(new URL('../../../../workflows/quick-fix.json', import.meta.url));

test('Q8: an item restored after the workflow file changed runs on its pinned workflow, finishes, and replays', async () => {
  const dir = fresh('tourney-workflows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'quick-fix.json'), V1);
  const d1 = createHash('sha256').update(V1).digest('hex');
  const w = await itemWorld({ dir });
  try {
    assert.equal(w.host.spec.id, `quick-fix@${d1}`);
    const A = await quickFixToMerge(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    assert.equal(transitionsOf(w.root)[0].payload.workflow, `quick-fix@${d1}`, 'the first row names the pinned digest');

    // The file changes on disk: other choices, and merging needs a guard that never holds.
    const v2 = JSON.parse(V1.toString('utf8'));
    v2.states.gated.states.awaitingMerge.invoke.input.choices = { value: ['ship', 'reject'] };
    v2.meta.guards.never = ['context.neverSet'];
    v2.states.merging.meta.needs.push('never');
    const V2 = Buffer.from(JSON.stringify(v2, null, 2));
    writeFileSync(join(dir, 'quick-fix.json'), V2);

    // A new host (another process, say) opens the item: it restores from the pin, not the file.
    w.host = w.open();
    w.handlers = w.handlersFor(w.host);
    assert.equal(w.host.spec.id, `quick-fix@${d1}`);
    assert.ok(w.host.spec.id.endsWith(`@${d1}`));
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    await tap(w, 0);
    assert.equal(w.host.snapshot.value, 'done');
    assert.deepEqual(w.gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);

    // The journal replays on the pinned workflow to the same hash.
    const entries = transitionsOf(w.root).filter((r) => r.payload.outcome === 'applied')
      .sort((a, b) => a.payload.seq - b.payload.seq)
      .map((r) => ({ seq: r.payload.seq, event: r.payload.event, hash: r.payload.hash }));
    const replayed = replay(pinnedWorkflow(w.root, ITEM), entries);
    assert.equal(hashOf(replayed), hashOf(w.host.snapshot));
    assert.equal(hashOf(replayed), entries.at(-1).hash);

    // Restoring with v2 as it stands on disk would not replay: that is why the pin is needed.
    const v2spec = { ...JSON.parse(V2.toString('utf8')), id: 'quick-fix' };
    assert.throws(() => restore({ root: w.root, item: ITEM, spec: v2spec, session: 'owner', release: RELEASE }), /the workflow changed/);
  } finally {
    await w.close();
  }
});

test('Q8: a pinned blob that does not hash to its name is refused', async () => {
  const dir = fresh('tourney-workflows');
  writeFileSync(join(dir, 'quick-fix.json'), V1);
  const w = await itemWorld({ dir });
  try {
    await quickFixToMerge(w);
    const d1 = w.host.spec.id.split('@')[1];
    writeFileSync(join(w.root, 'blobs', d1), Buffer.concat([V1, Buffer.from(' ')]));
    assert.throws(() => pinnedWorkflow(w.root, ITEM), /does not hash to its name/);
  } finally {
    await w.close();
  }
});
