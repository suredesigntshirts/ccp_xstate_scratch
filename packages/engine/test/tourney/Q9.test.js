// Q9 Expect edited on GitHub: the issue's acceptance lines change mid-build (could be an agent); grading must not
// change without the person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, prOut, transitions } from './world.js';

test('Q9 an issue edit mid-build is refused and journalled; the verifier grades against the expect lines the item started with', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const w = world({ gh });
    let { host } = await w.startItem('it-1', { issue: ISSUE });
    ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
    assert.equal(host.snapshot.value, 'building');

    let results;
    const edited = { event: { type: 'github.issues.edited', body: 'expect: something else', expect: ['anything passes'] }, source: { system: 'github', ref: 'issues.edited 1' } };
    ({ host, results } = await w.send('it-1', [edited]));
    assert.equal(results[0].outcome, 'refused');
    assert.match(results[0].row.payload.reason, /not an event quick-fix takes/);
    assert.ok(transitions(w.root, 'it-1').some((r) => r.payload.event.type === 'github.issues.edited' && r.payload.outcome === 'refused'), 'the refusal is journalled');
    // Nor can anything outside write the input fact by naming it.
    ({ results } = await w.send('it-1', [{ event: { type: 'input', issue: { url: ISSUE.url, expect: ['anything passes'] } }, source: { system: 'github', ref: 'forged input' } }]));
    assert.equal(results[0].outcome, 'refused');

    // A builder whose result also carries other acceptance lines changes nothing either: it is recorded under pr only.
    const built = await attested(host, 'pr', { ...prOut(1, A), input: { issue: { expect: ['anything passes'] } } }, { gh, worktreeHead: A });
    ({ host } = await w.send('it-1', [built.input]));
    assert.equal(host.snapshot.value, 'checking');
    const verify = w.agents.started.filter((e) => e.actor === 'verify').at(-1);
    assert.deepEqual(verify.input.input.issue.expect, ISSUE.expect, 'the verifier gets the original expect lines');
    assert.equal(verify.input.brief, BRIEFS.verifier, 'and the brief fixed before the build');
    assert.deepEqual(host.snapshot.context.facts.input.v.issue.expect, ISSUE.expect);
  } finally {
    await gh.close();
  }
});
