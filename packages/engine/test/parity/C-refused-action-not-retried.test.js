// C-refused-action-not-retried (plan/cases/work-item.md): a host effect refused by auto mode or a hook is journalled
// with the rule and not retried automatically; the item steps back with the refusal as input. The merge effect here
// is refused the way auto mode refused the stand-in's merge on 2026-10-31 ([Merge Without Review]).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, cardOf, effectRows, inputsOfWakeFor, offer, open, openRun, platform, tapWake, toAwaitingMerge, world } from './world.js';

const RULE = 'auto mode: Merge Without Review';

test('C-refused-action-not-retried: a refused merge is journalled with its rule, never started again, and the item steps back with it', async () => {
  let tries = 0;
  const refusing = { merge: { start: async () => { tries += 1; return { refused: { rule: RULE, text: 'Merging without review is blocked' } }; } } };
  const plat = platform();
  const { root, host, agents } = await toAwaitingMerge({ head: A, plat });
  const effects = world({ plat, actors: { ...agents.byActor, ...refusing } });
  await offer(host, inputsOfWakeFor(host, tapWake(cardOf(host, openRun(host, 'ask')))), effects);

  assert.equal(tries, 1);
  const refused = effectRows(root).filter((r) => r.payload.actor === 'merge' && r.payload.phase === 'refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].payload.rule, RULE);
  assert.equal(host.snapshot.value, 'replanning');
  assert.match(String(host.snapshot.context.failure), new RegExp(`refused by ${RULE}`));
  assert.deepEqual(plat.cards.at(-1).choices, ['replan', 'drop'], 'the step back is put to the person');

  // Neither this host nor a fresh one, on a later wake, starts the refused merge again.
  await offer(host, [], effects);
  await offer(open(root), [], effects);
  assert.equal(tries, 1);
});
