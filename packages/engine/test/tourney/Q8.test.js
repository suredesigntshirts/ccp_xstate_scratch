// Q8 Workflow changes in flight: the workflow file changes while an item waits for approval; the item finishes on
// the rules it started with and its journal still replays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { A, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, suiteWake, inputsOfWakeFor, tap, prOut, verdictOut, loadWorkflow, offer, transitions } from './world.js';
import { itemFile } from '../../src/index.js';

// The changed workflow: awaitingMerge renamed (which alone breaks replay of an unpinned journal), its question
// edited, guard `approved` renamed and now needing another choice, and a new state added.
function changed() {
  const spec = loadWorkflow('quick-fix');
  const text = JSON.stringify(spec).replaceAll('"awaitingMerge"', '"awaitingSignoff"').replaceAll('"approved"', '"shipIt"');
  const next = JSON.parse(text);
  next.states.awaitingSignoff.invoke.input.question = { value: 'Ship it?' };
  next.states.awaitingSignoff.invoke.input.choices = { value: ['ship it', 'reject'] };
  next.meta.guards.shipIt = [{ path: 'event.output.choice', is: 'ship it' }];
  next.states.parked = { type: 'final' };
  return next;
}

test('Q8 the workflow changes while an item waits for approval: it finishes on the rules it started with, and replays', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const original = loadWorkflow('quick-fix');
    const w = world({ gh });
    let { host } = await w.startItem('it-1', { issue: ISSUE }, original);
    const pin = transitions(w.root, 'it-1')[0].payload.spec;
    assert.equal(pin, createHash('sha256').update(JSON.stringify(original)).digest('hex'), 'the seq-0 row pins the spec');
    ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
    ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A })).input]));
    ({ host } = await w.send('it-1', [(await attested(host, 'verify', verdictOut('PASS', 1, A), { gh, worktreeHead: A })).input]));
    ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A))));
    assert.equal(host.snapshot.value, 'awaitingMerge');

    // The file changes. Restoring with the changed spec still replays, on the pinned one.
    const next = changed();
    const restored = w.open('it-1', next);
    assert.deepEqual(restored.spec, original);
    assert.equal(restored.snapshot.value, 'awaitingMerge');
    // The person taps "approve" (the old card's choice 0): under the old rules that merges.
    await offer(restored, tap(restored, 'approval', 0), w.handlers);
    const end = w.open('it-1', next);
    assert.equal(end.snapshot.value, 'done', 'finished on the rules it started with');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);

    // A new item started with the changed spec uses it, and pins the other hash.
    const { host: other } = await w.startItem('it-2', { issue: ISSUE }, next);
    const otherPin = transitions(w.root, 'it-2')[0].payload.spec;
    assert.notEqual(otherPin, pin);
    assert.deepEqual(w.open('it-2', original).spec, next, 'it-2 replays on its own pinned spec whatever spec is passed');
    void other;

    // Control: the same journal without its pin does not replay on the changed spec.
    const lines = readFileSync(itemFile(w.root, 'it-1'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const row of lines) if (row.kind === 'engine.transition' && row.payload.seq === 0) delete row.payload.spec;
    writeFileSync(itemFile(w.root, 'it-9'), lines.map((l) => JSON.stringify({ ...l, item: 'it-9' })).join('\n') + '\n');
    assert.throws(() => w.open('it-9', next), (e) => { console.log('control threw:', e.message); return /the workflow changed/.test(e.message); });
  } finally {
    await gh.close();
  }
});
