// The tripwire acted on (plan item engine-item-views): a PR past its round limit sends its item to replanning. The
// row is the one derive.js rework appends (packages/journal/src/derive/rework.js, tripwires()), written into the
// item's file; the host offers it once as a `tripwire` event, and quick-fix steps back only when it names the item's PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restore, offer } from '../src/index.js';
import { tripwiresOf } from '../src/tripwire.js';
import { append, readFile } from '../../journal/src/index.js';
import { tripwires } from '../../journal/src/derive/rework.js';
import { workflow, ISSUE, BRIEFS, A, pr, verdict, done, run } from './flow.js';

const TRIP = { type: 'tripwire', url: 'https://github.com/o/r/pull/1', rounds: 3, limit: 2 };

test('quick-fix: a tripwire on the item\'s PR steps back to replanning from building, verifying and awaitingMerge', () => {
  const toVerifying = [done('brief', BRIEFS), done('build', pr(A))];
  for (const [state, events] of [['verifying', toVerifying], ['awaitingMerge', [...toVerifying, done('verify', verdict('PASS', A))]], ['building', [...toVerifying, done('verify', verdict('FAIL', A))]]]) {
    assert.equal(run(events).value, state);
    const after = run([...events, TRIP]);
    assert.equal(after.value, 'replanning', `from ${state}`);
    assert.deepEqual([after.context.failure.tripwire, after.context.failure.rounds, after.context.failure.limit], [TRIP.url, 3, 2]);
  }
  assert.equal(run([...toVerifying, { ...TRIP, url: 'https://github.com/o/r/pull/9' }]).value, 'verifying', 'another PR\'s tripwire is not this item\'s');
});

// An item at verifying on o/r#1, stand-in actors for brief and build.
async function verifying(root) {
  const host = restore({ root, item: 'it-1', spec: workflow, session: 'owner', release: '0.2.0' });
  const outputs = { brief: BRIEFS, build: pr(A) };
  const actors = Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, { start: async (e) => ({ ref: e.id, output }) }]));
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 'owner' } }], { run: { start: (e) => actors[e.actor]?.start(e) } });
  return host;
}

test('the host offers rework\'s tripwire row for the item once, and the item moves to replanning', async () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-trip-'));
  let host = await verifying(root);
  assert.equal(host.snapshot.value, 'verifying');
  assert.deepEqual(tripwiresOf(host), []);
  const view = { prs: [{ repo: 'o/r', pr: 1, item: 'it-1', rounds: 3, inputs: [] }] };
  const [row] = tripwires(view, [], { session: 'derive', release: '0.2.0' }, { limitOf: () => 2 });
  const written = append(host.file, row);

  host = restore({ root, item: 'it-1', spec: workflow, session: 'owner', release: '0.2.0' });
  const inputs = tripwiresOf(host);
  assert.equal(inputs.length, 1);
  assert.deepEqual(inputs[0].source, { system: 'journal', ref: `tripwire ${written.id}` });
  const [result] = await offer(host, inputs, {});
  assert.equal(result.outcome, 'applied');
  assert.equal(host.snapshot.value, 'replanning');
  assert.deepEqual(tripwiresOf(restore({ root, item: 'it-1', spec: workflow, session: 'owner', release: '0.2.0' })), [], 'offered once');
  const t = readFile(host.file).rows.filter((r) => r.kind === 'engine.transition' && r.payload.event.type === 'tripwire');
  assert.equal(t.length, 1);
});
