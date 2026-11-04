// Q4 CI edited by the builder: the PR changes CI config and CI turns green; it must not merge on that green without
// the person explicitly approving a CI-changing PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWorld, quickFixToMerge, tap, writtenAnswer, openRun } from './world.js';

const ciChange = { 'math.js': 'export const multiply = (a, b) => a * b;\n', '.github/workflows/ci.yml': 'on: push\njobs: {}\n' };

async function toCiCard() {
  const w = await itemWorld();
  const A = await quickFixToMerge(w, { files: ciChange });
  return { w, A };
}

test('Q4: green CI on a CI-changing PR asks the CI question, and a reject merges nothing', async () => {
  const { w, A } = await toCiCard();
  try {
    assert.deepEqual(w.host.snapshot.context.pr.protected, ['.github/workflows/ci.yml'], 'attest read the changed files from GitHub');
    assert.equal(w.host.snapshot.context.ci.head, A, 'CI is green on the verified head');
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingCiApproval' });
    assert.equal(w.plat.cards.length, 1);
    assert.deepEqual(w.plat.cards[0].choices, ['approve-ci-change', 'reject']);
    assert.match(w.plat.cards[0].question, /changes CI configuration/);
    assert.equal(w.gh.merges.length, 0, 'no merge on the green alone');
    await tap(w, 1);
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});

test('Q4: the person tapping approve-ci-change is what merges it', async () => {
  const { w, A } = await toCiCard();
  try {
    await tap(w, 0);
    assert.equal(w.host.snapshot.context.decision.choice, 'approve-ci-change');
    assert.equal(w.host.snapshot.value, 'done');
    assert.deepEqual(w.gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);
  } finally {
    await w.close();
  }
});

test('Q4: a plain "approve" answer on a CI-changing PR does not reach merging', async () => {
  const { w } = await toCiCard();
  try {
    const ask = openRun(w.host, 'ask');
    assert.ok(ask);
    await writtenAnswer(w, { choice: 'approve' });
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});
