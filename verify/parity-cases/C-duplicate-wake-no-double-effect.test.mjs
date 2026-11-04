// Verifier's own test, from the case text alone: C-duplicate-wake-no-double-effect. The same GitHub event delivered
// twice, or a host restart mid-effect, makes the merge, post or spawn happen once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, checkWake, handlersFor, inputsOfWake, offer, open, rowsOf, toAwaitingMerge, VERDICT, PR, BRIEFS, fresh, start, askRun } from './lib.mjs';

test('the same red-check wake twice, then to a restarted host, spawns one rebuild', async () => {
  const w = await toAwaitingMerge();
  assert.equal(w.count('build'), 1);
  const wake = checkWake({ head: A });
  const first = await offer(w.host, [...inputsOfWake(w.host, wake), ...inputsOfWake(w.host, wake)], w.handlers);
  assert.deepEqual(first.map((r) => r.outcome), ['applied', 'duplicate']);
  assert.equal(w.count('build'), 2);
  // restart: a new host from the same file sees the same wake again
  const again = open(w.root);
  const late = await offer(again, inputsOfWake(again, wake), w.handlers);
  assert.deepEqual(late.map((r) => r.outcome), ['duplicate']);
  assert.equal(w.count('build'), 2, 'still one rebuild');
});

test('a host restart mid-merge does not merge twice (no way to look up: marked unknown; with a lookup: completed from it)', async () => {
  for (const lookup of [false, true]) {
    const w = await toAwaitingMerge();
    let merges = 0;
    const dying = handlersFor({ merge: () => { merges += 1; return new Promise(() => {}); } });
    // approve; the merge reaches "GitHub" then the process dies (the promise never settles)
    const ask = askRun(w.host);
    offer(w.host, [{ event: { type: 'xstate.done.actor.ask', output: { choice: 'approve', by: 'person' } }, run: ask.id, source: { system: 'hearth', ref: 'card-1' } }], dying.handlers);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(merges, 1);
    const after = open(w.root);
    assert.equal(after.snapshot.value, 'merging');
    const h2 = handlersFor({ merge: () => { merges += 1; return { output: { sha: 'd'.repeat(40) } }; }, find: lookup ? async (e) => (e.actor === 'merge' ? { output: { sha: 'd'.repeat(40) } } : null) : undefined });
    await offer(after, [], h2.handlers);
    assert.equal(merges, 1, `lookup=${lookup}: the merge is not started again`);
    const phases = rowsOf(w.root).filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge').map((r) => r.payload.phase);
    assert.equal(phases.filter((p) => p === 'start').length, 1, phases.join());
    if (lookup) assert.equal(after.snapshot.value, 'done');
  }
});

test('a card (post) is put up once when the host is restarted and offered nothing', async () => {
  const w = await toAwaitingMerge();
  const before = w.count('ask');
  await offer(open(w.root), [], w.handlers);
  await offer(open(w.root), [], w.handlers);
  assert.equal(w.count('ask'), before);
});
