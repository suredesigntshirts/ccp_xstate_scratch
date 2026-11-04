// F1 Three slices; slice 2 fails verify on every build: rounds are bounded and it escalates; slice 1's merged work is
// kept; the whole feature's acceptance is verified before it reaches main, with <= 1 person tap for the feature's merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, agentReturns, tap, openRun, ISSUE, BRIEFS, prUrl, buildBranch, wake } from './world.js';
import { feature, startFeature, currentChild, childToPass, hearParent, slice, childItems, tapsIn } from './feature-world.js';

test('F1: slice 2 fails every build, escalates within its bound; slice 1 is kept; the whole feature is verified, then one tap merges it to main', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const w = { repo, gh, plat };
    const { host: parent, effects } = feature({ root, ...w });
    await startFeature(parent, effects);
    await agentReturns(parent, 'plan', { slices: [slice(1, 'add multiply'), slice(2, 'add divide'), slice(3, 'document both')] }, { gh, effects });
    assert.equal(parent.snapshot.value, 'slicing');
    assert.equal(parent.snapshot.context.slices.count, 3, 'the count is the host\'s, from the accepted plan');

    // Slice 1 merges into the feature branch under policy approval: no card.
    const s1 = currentChild(parent, w);
    await childToPass(s1, { ...w, n: 1 });
    assert.equal(s1.host.snapshot.value, 'done');
    assert.equal(s1.host.snapshot.context.approval.by, 'policy');
    await hearParent(parent, effects);
    assert.equal(parent.snapshot.context.slices.at, 1);

    // Slice 2 fails verify on every build: its builds are bounded (2), then it escalates to the person.
    const s2 = currentChild(parent, w);
    await childToPass(s2, { ...w, n: 2, verify: 'FAIL' });
    assert.equal(s2.host.snapshot.value, 'building');
    const again = repo.commit('pr2b');
    gh.push(2, again);
    gh.green(again);
    await agentReturns(s2.host, 'build', { pr: { branch: buildBranch(s2.host), headSha: again, url: prUrl(2) } }, { gh, effects: s2.effects });
    await agentReturns(s2.host, 'verify', { result: 'FAIL', report: 'still not' }, { checkout: again, gh, effects: s2.effects });
    assert.equal(s2.host.snapshot.value, 'replanning', 'past its bound the slice escalates');
    assert.equal(s2.host.snapshot.context.builds, 2);
    assert.match(plat.cards.at(-1).question, /stalled/);
    await tap(s2.host, { effects: s2.effects, index: 1 }); // the person drops the slice
    await hearParent(parent, effects);
    assert.equal(parent.snapshot.value, 'planning', 'the planner re-plans the rest (a two-way door, bounded by replans)');
    assert.equal(parent.snapshot.context.replans, 1);
    assert.equal(openRun(parent, 'plan').input.merged, 1, 'the planner is told slice 1 is merged');

    await agentReturns(parent, 'plan', { slices: [slice(2, 'add divide, guarded'), slice(3, 'document both')] }, { gh, effects });
    for (const n of [3, 4]) {
      const s = currentChild(parent, w);
      await childToPass(s, { ...w, n });
      assert.equal(s.host.snapshot.value, 'done');
      await hearParent(parent, effects);
    }
    assert.equal(parent.snapshot.value, 'finishing');
    assert.equal(gh.prs[1].merged, true, 'slice 1\'s merged work is kept');
    assert.equal(gh.merges.filter((m) => m.number === 1).length, 1, 'and never redone');
    assert.equal(childItems(root).length, 5, 'slices 1, 2, 2b, 3 and the final: none started twice');
    assert.equal(gh.merges.length, 3, 'three slices merged into the feature branch, nothing to main yet');

    // The final PR, from the feature branch to main, is verified against the whole feature's Expect lines.
    const fin = currentChild(parent, w);
    await agentReturns(fin.host, 'brief', BRIEFS, { gh, effects: fin.effects });
    assert.equal(buildBranch(fin.host), 'feature/feat-1');
    const F = repo.commit('feature head');
    gh.open(5, { head: F, branch: 'feature/feat-1' });
    gh.green(F);
    await agentReturns(fin.host, 'build', { pr: { branch: 'feature/feat-1', headSha: F, url: prUrl(5) } }, { gh, effects: fin.effects });
    assert.deepEqual(openRun(fin.host, 'verify').input.issue.expect, ISSUE.expect, 'the whole feature\'s acceptance');
    await agentReturns(fin.host, 'verify', { result: 'PASS', report: 'whole feature ok' }, { checkout: F, gh, effects: fin.effects });
    await wake(fin.host, { gh, effects: fin.effects });
    assert.equal(fin.host.snapshot.value, 'asking');
    assert.equal(gh.merges.length, 3, 'nothing reaches main before the person');
    await tap(fin.host, { effects: fin.effects, index: 0 });
    assert.equal(fin.host.snapshot.value, 'done');
    assert.deepEqual(gh.merges.at(-1), { number: 5, sha: F });
    await hearParent(parent, effects);
    assert.equal(parent.snapshot.value, 'done');

    const ids = childItems(root);
    const mergeTaps = tapsIn(root, ids.at(-1));
    const sliceTaps = ids.slice(0, -1).reduce((n, id) => n + tapsIn(root, id), 0);
    assert.equal(mergeTaps, 1, 'one person tap for the feature\'s merge');
    assert.equal(sliceTaps, 1, 'plus the one escalation tap on slice 2');
    assert.equal(tapsIn(root, 'feat-1'), 0);
  } finally {
    await gh.close();
  }
});

test('F1: a slice that fails under every plan stops after the replan bound and goes to the person', async () => {
  const gh = await fakeGitHub();
  try {
    const root = fresh();
    const repo = gitRepo();
    const plat = platform();
    const w = { repo, gh, plat };
    const { host: parent, effects } = feature({ root, ...w });
    await startFeature(parent, effects);
    let n = 0;
    for (let round = 0; round < 2; round += 1) {
      await agentReturns(parent, 'plan', { slices: [slice(1, 'add divide')] }, { gh, effects });
      const s = currentChild(parent, w);
      await childToPass(s, { ...w, n: ++n, verify: 'FAIL' });
      const head = repo.commit(`r${round}`);
      gh.push(n, head);
      await agentReturns(s.host, 'build', { pr: { branch: buildBranch(s.host), headSha: head, url: prUrl(n) } }, { gh, effects: s.effects });
      await agentReturns(s.host, 'verify', { result: 'FAIL', report: 'no' }, { checkout: head, gh, effects: s.effects });
      assert.equal(s.host.snapshot.value, 'replanning');
      await tap(s.host, { effects: s.effects, index: 1 });
      await hearParent(parent, effects);
    }
    assert.equal(parent.snapshot.value, 'replanning', 'bounded: after two planner rounds the feature goes to the person');
    assert.equal(parent.snapshot.context.failure.kind, 'slice');
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});
