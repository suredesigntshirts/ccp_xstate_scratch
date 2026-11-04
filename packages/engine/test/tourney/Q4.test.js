// Q4 CI edited by the builder: the PR changes .github/workflows/* and CI turns green; it must not merge on that green
// without the person explicitly approving a CI-changing PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, ISSUE, BRIEFS, builds, verifies, tapWake } from './world.js';

async function toVerified(w, item, input) {
  await w.start(item, 'quick-fix', input);
  assert.ok((await w.agent(item, 'brief', () => BRIEFS)).accepted);
  await w.drive(item);
  assert.ok((await w.agent(item, 'build', builds(w, 1, { green: true, files: ['src/math.js', '.github/workflows/ci.yml'] }))).accepted);
  await w.drive(item);
  assert.equal(w.host(item).snapshot.value, 'verifying', 'CI is green on the head');
  assert.ok((await w.agent(item, 'verify', verifies(w, 'PASS'))).accepted);
  await w.drive(item);
}

test('Q4: a CI-changing PR, green and verified, waits for an explicit approval of the CI change; reject does not merge', async () => {
  const w = await makeWorld();
  try {
    await toVerified(w, 'q4', { issue: ISSUE });
    const h = w.host('q4');
    assert.equal(h.snapshot.value, 'awaitingGates', 'not merging, not awaitingMerge');
    assert.deepEqual(h.snapshot.context.verdict.pr.gates, ['.github/workflows/ci.yml'], 'gates stamped by the host from the PR files');
    assert.equal(h.snapshot.context.pr.green, true);
    assert.deepEqual(w.plat.cards.at(-1).choices, ['approve CI change', 'reject']);
    assert.deepEqual(w.gh.merges, [], 'no merge on the builder-made green');
    await w.drive('q4', tapWake(w.cardOf('q4'), 1));
    assert.equal(w.host('q4').snapshot.value, 'replanning');
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});

test('Q4: the explicit approval of the CI change merges at the verified head, and records it', async () => {
  const w = await makeWorld();
  try {
    await toVerified(w, 'q4', { issue: ISSUE });
    const head = w.gh.state[1].head;
    await w.drive('q4', tapWake(w.cardOf('q4'), 0));
    const h = w.host('q4');
    assert.equal(h.snapshot.value, 'done');
    assert.deepEqual(h.snapshot.context.decision.gates, ['.github/workflows/ci.yml']);
    assert.equal(h.snapshot.context.decision.choice, 'approve');
    assert.deepEqual(w.gh.merges, [{ number: 1, sha: head, base: 'main' }]);
  } finally {
    await w.close();
  }
});

test('Q4: a parent\'s grant (a feature slice) does not skip the CI-change card', async () => {
  const w = await makeWorld();
  try {
    const grant = { choice: 'approve', by: 'feature' };
    await toVerified(w, 'q4g', { issue: ISSUE, base: 'feature/x', grant, decision: grant });
    assert.equal(w.host('q4g').snapshot.value, 'awaitingGates');
    assert.deepEqual(w.gh.merges, []);
  } finally {
    await w.close();
  }
});

// Round 2, graft from lane B: the gates fail closed. When GitHub cannot list the PR's files, or lists a full page,
// the gates are unknown, and an unknown gate asks the person exactly as a CI change does.
for (const [name, setup] of [
  ['the files call fails', (w) => { w.gh.state[1].filesError = true; }],
  ['the PR has a full page of files', (w) => { w.gh.state[1].files = Array.from({ length: 100 }, (_, i) => `src/f${i}.js`); }]
]) {
  test(`Q4 (round 2, fail closed): ${name}: no merge on green without the CI-change card`, async () => {
    const w = await makeWorld();
    try {
      await w.start('q4c', 'quick-fix', { issue: ISSUE });
      assert.ok((await w.agent('q4c', 'brief', () => BRIEFS)).accepted);
      await w.drive('q4c');
      assert.ok((await w.agent('q4c', 'build', async (a) => { const r = await builds(w, 1, { files: ['src/math.js'] })(a); setup(w); return r; })).accepted);
      await w.drive('q4c');
      assert.ok((await w.agent('q4c', 'verify', verifies(w, 'PASS'))).accepted);
      await w.drive('q4c');
      const h = w.host('q4c');
      assert.equal(h.snapshot.value, 'awaitingGates');
      assert.match(h.snapshot.context.verdict.pr.gates[0], /^\(unknown: /);
      assert.deepEqual(w.gh.merges, []);
    } finally {
      await w.close();
    }
  });
}
