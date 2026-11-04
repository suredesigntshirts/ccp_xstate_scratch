// Q7 Merge outside the host: the PR is merged on GitHub by someone else; the item must not end as verified-done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, toJudging, agentReturns, wake, tap } from './world.js';

for (const where of ['judging', 'asking']) {
  test(`Q7: a merge on GitHub by someone else while ${where} ends the item landedUnverified, never done`, async () => {
    const gh = await fakeGitHub();
    try {
      const repo = gitRepo();
      const plat = platform();
      const { host, effects } = hostFor({ root: fresh(), repo, gh, plat });
      const A = repo.commit('A');
      await toJudging(host, { gh, effects, head: A });
      if (where === 'asking') {
        await agentReturns(host, 'verify', { result: 'PASS', report: 'ok' }, { checkout: A, gh, effects });
        gh.green(A);
        await wake(host, { gh, effects });
      }
      assert.equal(host.snapshot.value, where);
      // Someone merges #1 on GitHub, not through the host's merge effect.
      Object.assign(gh.prs[1], { merged: true, mergeSha: 'f'.repeat(40), state: 'closed' });
      await wake(host, { gh, effects });
      assert.equal(host.snapshot.status, 'done');
      assert.equal(host.snapshot.value, 'landedUnverified');
      assert.notEqual(host.snapshot.value, 'done');
      assert.equal(host.snapshot.context.merge, null, 'no host merge is recorded');
      assert.equal(gh.merges.length, 0, 'the host never called merge');
      if (where === 'asking') await assert.rejects(tap(host, { effects, index: 0 }), /no open card/);
    } finally {
      await gh.close();
    }
  });
}
