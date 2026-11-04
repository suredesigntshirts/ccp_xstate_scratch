// Q8 workflow changes in flight: the workflow file changes while an item waits for approval; the item finishes on the
// rules it started with and its journal still replays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { restore } from '../../src/host.js';
import { replay } from '../../src/spec.js';
import { makeWorld, fresh, ISSUE, BRIEFS, builds, verifies, tapWake, loadWorkflow, workflowOf, RELEASE } from './world.js';

const REPO_QF = new URL('../../../../workflows/quick-fix.json', import.meta.url);

test('Q8: an item pinned to v1 finishes on v1 after the file becomes v2, and its journal replays', async () => {
  const dir = fresh('workflows');
  mkdirSync(dir, { recursive: true });
  const v1 = JSON.parse(readFileSync(REPO_QF, 'utf8'));
  writeFileSync(join(dir, 'quick-fix.json'), JSON.stringify(v1, null, 2));
  const w = await makeWorld({ dir });
  try {
    await w.start('q8', 'quick-fix', { issue: ISSUE });
    const pinned = w.rows('q8').find((r) => r.kind === 'engine.transition' && r.payload.seq === 0).payload.workflow;
    assert.match(pinned, /^quick-fix@[0-9a-f]{64}$/);
    assert.ok((await w.agent('q8', 'brief', () => BRIEFS)).accepted);
    await w.drive('q8');
    assert.ok((await w.agent('q8', 'build', builds(w, 1))).accepted);
    await w.drive('q8');
    assert.ok((await w.agent('q8', 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('q8');
    assert.equal(w.host('q8').snapshot.value, 'awaitingMerge');
    const head = w.gh.state[1].head;

    // v2: a new question, a stricter approval rule ("ship it", which no v1 card offers), and an extra state.
    const v2 = structuredClone(v1);
    v2.states.awaitingMerge.invoke.input.question = { value: 'v2: ship it?' };
    v2.states.awaitingMerge.invoke.input.choices = { value: ['ship it', 'reject'] };
    v2.meta.guards.approved = [{ path: 'context.decision.choice', in: ['ship it'] }];
    v2.states.parked = { type: 'final' };
    writeFileSync(join(dir, 'quick-fix.json'), JSON.stringify(v2, null, 2));
    assert.notEqual(loadWorkflow('quick-fix', { dir, root: w.root }).id, pinned, 'the file on disk is now another workflow');

    // A new process: restore loads the pinned bytes, not the file as it is now.
    const spec = workflowOf(w.root, 'q8');
    assert.equal(spec.id, pinned);
    assert.deepEqual(spec.meta.guards.approved, v1.meta.guards.approved);
    const again = restore({ root: w.root, item: 'q8', spec, session: w.session, release: RELEASE });
    assert.equal(again.snapshot.value, 'awaitingMerge', 'every applied row replays to its recorded hash');
    assert.equal(w.plat.cards.at(-1).question, v1.states.awaitingMerge.invoke.input.question.value);

    await w.drive('q8', tapWake(w.cardOf('q8'), 0)); // "approve": v1's rule
    assert.equal(w.host('q8').snapshot.value, 'done');
    assert.deepEqual(w.gh.merges, [{ number: 1, sha: head, base: 'main' }]);

    // The whole journal still replays (pure), on the pinned spec.
    const entries = w.rows('q8').filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'applied')
      .map((r) => ({ seq: r.payload.seq, event: r.payload.event, hash: r.payload.hash })).sort((a, b) => a.seq - b.seq);
    assert.equal(replay(workflowOf(w.root, 'q8'), entries).value, 'done');
    // For the record: replaying the same journal on v2 (the unpinned file) does not end done.
    let onV2;
    try { onV2 = replay({ ...v2, id: 'quick-fix' }, entries).value; } catch (e) { onV2 = `throws: ${e.message}`; }
    assert.notEqual(onV2, 'done');
  } finally {
    await w.close();
  }
});
