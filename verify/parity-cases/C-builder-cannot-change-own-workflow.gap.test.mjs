// Verifier's characterisation of a GAP: C-builder-cannot-change-own-workflow is NOT met on the engine at the head
// (gaps.json, given to fix-workflow-pinned). The case: given an item in progress, when its builder changes the item's
// workflow selection or the workflow file it runs, then the item keeps running the workflow and hash recorded when it
// was filed. Today nothing is recorded at filing, so a changed file that replays to the same snapshots is run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { A, B, BRIEFS, PR, VERDICT, fresh, handlersFor, offer, open, rowsOf, spec, start } from './lib.mjs';
import { restore } from '../../packages/engine/src/index.js';

const looser = structuredClone(spec);
looser.meta.guards.buildsLeft = [{ path: 'context.builds', below: 99 }]; // the builder's edit: unlimited builds

test('GAP C-builder-cannot-change-own-workflow: an item filed under quick-fix is restored and run under an edited file', async () => {
  const root = fresh();
  const host = open(root);
  const h = handlersFor({ brief: [BRIEFS], build: [PR(A)], verify: [] });
  await offer(host, [start()], h.handlers);
  assert.equal(host.snapshot.value, 'verifying');

  // Nothing about the workflow file is recorded at filing: no row holds its hash.
  const text = JSON.stringify(rowsOf(root));
  const hashes = [JSON.stringify(spec), JSON.stringify(spec, null, 2)].map((s) => createHash('sha256').update(s).digest('hex'));
  for (const hash of hashes) assert.ok(!text.includes(hash), 'no workflow hash is journalled');

  // Restoring under the edited workflow is accepted (the replay reaches the same snapshot hashes).
  const edited = restore({ root, item: 'it-1', spec: looser, session: 'owner', release: '0.2.0' });
  assert.equal(edited.snapshot.value, 'verifying');

  // And the item then runs the edited rules: two FAILs would replan under the filed workflow (C-second-fail-replans),
  // but under the edited one a third build starts.
  const h2 = handlersFor({ build: [PR(B), PR(B)], verify: [] });
  const verifyRun = [...edited.runs.values()].find((r) => r.actor === 'verify');
  await offer(edited, [{ event: { type: `xstate.done.actor.${verifyRun.invoke}`, output: VERDICT('FAIL', A) }, run: verifyRun.id, source: { system: 'harness', ref: 'v1' } }], h2.handlers);
  assert.equal(edited.snapshot.value, 'verifying', 'rebuilt (build 2) and verifying again');
  const verify2 = [...edited.runs.values()].find((r) => r.actor === 'verify');
  await offer(edited, [{ event: { type: `xstate.done.actor.${verify2.invoke}`, output: VERDICT('FAIL', B) }, run: verify2.id, source: { system: 'harness', ref: 'v2' } }], h2.handlers);
  assert.equal(h2.count('build'), 2, 'builds 2 and 3 both ran under the edited file');
  assert.equal(edited.snapshot.context.builds, 3, 'the item is on its third build; the filed workflow allows two');
});
