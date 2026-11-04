// C-missing-expect-fails-closed (plan/cases/work-item.md): an item with no Expect lines can't leave queued, and the
// refusal names the missing input. Driven through the host and through bin/host.js start, as a session files it.
import { test } from 'node:test';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { ISSUE, agents, BRIEFS, fresh, gitRepo, hostCli, offer, open, start, transitions, world } from './world.js';

test('C-missing-expect-fails-closed: an issue with no expect, or an empty one, is refused naming expect, and no item or run exists', async () => {
  for (const [issue, why] of [[{ url: ISSUE.url }, /expect is missing/], [{ ...ISSUE, expect: [] }, /expect has fewer than 1 items/]]) {
    const root = fresh();
    const host = open(root);
    const a = agents({ brief: BRIEFS });
    const [result] = await offer(host, [start('owner', { issue })], world({ actors: a.byActor }));
    assert.equal(result.outcome, 'refused');
    assert.match(result.row.payload.reason, why);
    assert.equal(host.snapshot, null, 'the item never started');
    assert.equal(host.owner, null);
    assert.equal(a.started.length, 0, 'no brief ran');
    const rows = transitions(root);
    assert.deepEqual(rows.map((r) => [r.payload.outcome, r.payload.seq]), [['refused', null]], 'the refusal is journalled, and nothing applied');
    assert.match(rows[0].payload.reason, why);
    assert.equal(open(root).snapshot, null, 'restored, it is still not started');
  }
});

test('C-missing-expect-fails-closed: bin/host.js start refuses it too, and the control with Expect lines starts', async () => {
  const root = fresh();
  const refused = await hostCli(root, ['start', '--session', 's1', '--input', JSON.stringify({ issue: { url: ISSUE.url } })]);
  const out = JSON.parse(refused.stdout);
  assert.equal(out.state, null);
  assert.equal(out.results[0].outcome, 'refused');
  assert.match(out.results[0].reason, /expect is missing/);

  const root2 = fresh();
  const ok = JSON.parse((await hostCli(root2, ['start', '--session', 's1', '--input', JSON.stringify({ issue: ISSUE }), '--repo', gitRepo(), '--worktrees', join(root2, 'wt')])).stdout);
  assert.equal(ok.results[0].outcome, 'applied');
  assert.equal(ok.state, 'briefing');
});
