// Q1 Happy path: issue -> brief -> build -> verify PASS -> CI green -> person approves -> merged at the verified head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, suiteWake, inputsOfWakeFor, tap, prOut, verdictOut, transitions } from './world.js';

async function toBuilt(gh) {
  const w = world({ gh });
  let { host } = await w.startItem('it-1', { issue: ISSUE });
  assert.equal(host.snapshot.value, 'briefing');
  ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
  assert.equal(host.snapshot.value, 'building');
  const built = await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A });
  ({ host } = await w.send('it-1', [built.input]));
  assert.equal(host.snapshot.value, 'checking');
  return { w, host };
}

for (const order of ['verdict then green', 'green then verdict']) {
  test(`Q1 happy path (${order}): one tap, merged at the verified head`, async () => {
    const gh = await fakeGitHub({ 1: { head: A } });
    try {
      let { w, host } = await toBuilt(gh);
      const pass = await attested(host, 'verify', verdictOut('PASS', 1, A), { gh, worktreeHead: A });
      assert.ok(pass.input, JSON.stringify(pass.refused));
      if (order === 'verdict then green') {
        ({ host } = await w.send('it-1', [pass.input]));
        assert.equal(host.snapshot.value, 'checking', 'a PASS alone is not enough: CI is not green yet');
        ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A))));
      } else {
        ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A))));
        assert.equal(host.snapshot.value, 'checking', 'green CI alone is not enough');
        ({ host } = await w.send('it-1', [pass.input]));
      }
      assert.equal(host.snapshot.value, 'awaitingMerge');
      assert.equal(w.plat.cards.length, 1);
      assert.equal(gh.merges.length, 0, 'nothing merges before the person approves');

      const taps = tap(host, 'approval', 0); // "approve"
      ({ host } = await w.send('it-1', taps));
      assert.equal(host.snapshot.value, 'done');
      assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);
      assert.equal(host.snapshot.context.facts.merge.v.sha.length, 40);
      assert.equal(w.plat.cards.length, 1, 'Q1 costs exactly one card');
      const tapRows = transitions(w.root, 'it-1').filter((r) => r.source.system === 'hearth' && r.payload.outcome === 'applied');
      assert.equal(tapRows.length, 1, 'one person tap on the happy path');
    } finally {
      await gh.close();
    }
  });
}
