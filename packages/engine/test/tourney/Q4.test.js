// Q4 CI edited by the builder: the PR changes .github/workflows/* and CI turns green; it must not merge on that green
// without the person explicitly approving a CI-changing PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, suiteWake, inputsOfWakeFor, tap, prOut, verdictOut, transitions } from './world.js';

async function toGreen(gh) {
  const w = world({ gh });
  let { host } = await w.startItem('it-1', { issue: ISSUE });
  ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
  ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A })).input]));
  const pass = await attested(host, 'verify', verdictOut('PASS', 1, A), { gh, worktreeHead: A });
  assert.deepEqual(pass.input.event.seen.github.ci, ['.github/workflows/ci.yml'], 'the host saw the CI change on GitHub');
  ({ host } = await w.send('it-1', [pass.input]));
  ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A))));
  return { w, host };
}
const states = (root) => transitions(root, 'it-1').filter((r) => r.payload.outcome === 'applied').map((r) => r.state);

test('Q4 CI changed: green CI leads to a CI-change card, not the plain merge card; a plain approve does not merge', async () => {
  const gh = await fakeGitHub({ 1: { head: A, files: ['.github/workflows/ci.yml', 'src/x.js'] } });
  try {
    let { w, host } = await toGreen(gh);
    assert.equal(host.snapshot.value, 'awaitingCiMerge');
    assert.equal(w.plat.cards.length, 1);
    assert.deepEqual(w.plat.cards[0].choices, ['approve CI change', 'reject']);
    assert.match(w.plat.cards[0].question, /changes CI config/);
    assert.equal(gh.merges.length, 0, 'no merge on the green alone');
    // An answer of plain "approve" (as if from the ordinary card) does not merge here.
    ({ host } = await w.send('it-1', [{ event: { type: 'xstate.done.actor.approval', output: { choice: 'approve', by: 'person' } }, run: [...host.runs.values()].find((r) => r.invoke === 'approval').id, source: { system: 'hearth', ref: 'forged-plain-approve' } }]));
    assert.equal(host.snapshot.value, 'replanning', 'a plain approve on the CI card falls through to replanning');
    assert.equal(gh.merges.length, 0, 'a plain approve is not an approval of a CI change');
    assert.ok(!states(w.root).includes('"awaitingMerge"'), 'never entered the plain awaitingMerge');
  } finally {
    await gh.close();
  }
});

test('Q4 CI changed: tapping reject goes to replanning with no merge', async () => {
  const gh = await fakeGitHub({ 1: { head: A, files: ['.github/workflows/ci.yml', 'src/x.js'] } });
  try {
    let { w, host } = await toGreen(gh);
    assert.equal(host.snapshot.value, 'awaitingCiMerge');
    ({ host } = await w.send('it-1', tap(host, 'approval', 1)));
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});

test('Q4 CI changed: the explicit "approve CI change" tap merges at the verified head (1 tap); never via awaitingMerge', async () => {
  const gh = await fakeGitHub({ 1: { head: A, files: ['.github/workflows/ci.yml', 'src/x.js'] } });
  try {
    let { w, host } = await toGreen(gh);
    ({ host } = await w.send('it-1', tap(host, 'approval', 0)));
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: A }]);
    assert.equal(w.plat.cards.length, 1);
    assert.ok(!states(w.root).includes('"awaitingMerge"'));
  } finally {
    await gh.close();
  }
});

test('Q4 control: the same PR without a .github change gets the plain merge card', async () => {
  const gh = await fakeGitHub({ 1: { head: A, files: ['src/x.js'] } });
  try {
    const w = world({ gh });
    let { host } = await w.startItem('it-1', { issue: ISSUE });
    ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
    ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A })).input]));
    ({ host } = await w.send('it-1', [(await attested(host, 'verify', verdictOut('PASS', 1, A), { gh, worktreeHead: A })).input]));
    ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A))));
    assert.equal(host.snapshot.value, 'awaitingMerge');
  } finally {
    await gh.close();
  }
});
