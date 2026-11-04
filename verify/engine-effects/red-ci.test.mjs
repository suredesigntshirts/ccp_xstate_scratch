// Expect red-ci (world): scratch PR suredesigntshirts/ccp_xstate_scratch#18 carries a deliberately failing test. GitHub's
// real check run for its head is saved in evidence/check-runs-pr18.json (REST /commits/<sha>/check-runs, fetched by
// world/red-ci-fetch.sh once the run completed red). The wake text is REBUILT from those REST facts in the shape of
// packages/engine/test/fixtures/wakes/check-run-failed.txt; that rebuilt text was not delivered by the platform. The last
// test uses the wake the platform DID deliver for this PR (evidence/delivered-wake-pr18.txt, relayed to me by the
// coordinator from the builder's session, its HTML comment shortened) and checks its facts against REST. It goes
// through the real wake parser (inputsOfWake) into a real host item in `verifying` for that PR head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restore, offer, inputsOfWake, loadWorkflow, itemFile } from '../../packages/engine/src/index.js';
import { readFile } from '../../packages/journal/src/index.js';

const rest = JSON.parse(readFileSync(new URL('./evidence/check-runs-pr18.json', import.meta.url), 'utf8'));
const HEAD = 'cd2adfb894be738dc3071dac9ac660b42f2caa0e';
const run = rest.check_runs[0];
const fixture = readFileSync(new URL('../../packages/engine/test/fixtures/wakes/check-run-failed.txt', import.meta.url), 'utf8');

// The fixture's shape, with its JSON replaced by REST's facts.
const wakeFor = (facts) => fixture.replace(/\{"check":.*\}/, JSON.stringify(facts));
const facts = (r, pr = 'suredesigntshirts/ccp_xstate_scratch#18') =>
  ({ check: r.name, check_run_id: r.id, conclusion: r.conclusion, details_url: r.details_url, head_sha: r.head_sha, pr });

const PR = { branch: 'verify/engine-effects-red-ci', headSha: HEAD, url: 'https://github.com/suredesigntshirts/ccp_xstate_scratch/pull/18' };
async function itemInVerifying() {
  const root = mkdtempSync(join(tmpdir(), 'ee-redci-'));
  const builds = [];
  const actors = {
    brief: { start: async () => ({ output: { builder: 'b.md', verifier: 'v.md' } }) },
    build: { start: async (e) => { builds.push(e.input); return builds.length === 1 ? { output: { pr: PR } } : { ref: 'build-2-running' }; } },
    verify: { start: async () => ({ ref: 'verifier-running' }) } // the verifier is still working: no verdict yet
  };
  const handlers = { run: { handles: (e) => e.actor in actors, start: (e) => actors[e.actor].start(e), find: () => undefined } };
  const host = restore({ root, item: 'redci-18', spec: loadWorkflow('quick-fix'), session: 'verifier-engine-effects', release: '0.2.0' });
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: { url: 'https://github.com/o/r/issues/1', expect: ['x'] } } }, source: { system: 'claude-code', ref: 'v' } }], handlers);
  return { host, handlers, builds, root };
}

test('the saved REST facts are a real red check run on the PR head', () => {
  assert.equal(rest.total_count, 1);
  assert.deepEqual([run.name, run.status, run.conclusion, run.head_sha], ['test', 'completed', 'failure', HEAD]);
  assert.match(run.details_url, /^https:\/\/github\.com\/suredesigntshirts\/ccp_xstate_scratch\/actions\/runs\//);
});

test('red-ci: a red check on the PR head sends a verifying item back to building, naming the check, and the new build gets it', async () => {
  const { host, handlers, builds, root } = await itemInVerifying();
  assert.equal(host.snapshot.value, 'verifying');
  assert.equal(host.snapshot.context.pr.headSha, HEAD);
  assert.equal(builds.length, 1);

  const inputs = inputsOfWake(host, wakeFor(facts(run)));
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].event.type, 'github.check_run.completed');
  const [result] = await offer(host, inputs, handlers);

  assert.equal(result.outcome, 'applied');
  assert.equal(host.snapshot.value, 'building');
  assert.equal(host.snapshot.context.failure.check, 'test');
  assert.equal(host.snapshot.context.failure.conclusion, 'failure');
  assert.equal(host.snapshot.context.failure.sha, HEAD);
  assert.equal(host.snapshot.context.failure.url, run.details_url);
  assert.equal(host.snapshot.context.builds, 1);
  // The second build started, with the failing check in its input.
  assert.equal(builds.length, 2);
  assert.equal(builds[1].failure.check, 'test');
  assert.equal(builds[1].failure.url, run.details_url);
  // It never reached merging, and the journal row says which wake source did it.
  const rows = readFile(itemFile(root, 'redci-18')).rows.filter((r) => r.kind === 'engine.transition');
  assert.ok(!rows.some((r) => String(r.state).includes('merging')));
  assert.ok(rows.some((r) => r.source.system === 'github' && r.payload.event.type === 'github.check_run.completed'));
});

test('red-ci: a red check on another head, or a green one, does not send it back', async () => {
  const { host, handlers, builds } = await itemInVerifying();
  const other = facts({ ...run, head_sha: 'e'.repeat(40) });
  const green = facts({ ...run, conclusion: 'success' });
  for (const f of [other, green]) {
    const results = await offer(host, inputsOfWake(host, wakeFor(f)), handlers);
    assert.notEqual(host.snapshot.value, 'building', JSON.stringify(results.map((r) => r.outcome)));
  }
  assert.equal(host.snapshot.value, 'verifying');
  assert.equal(builds.length, 1);
});

test('red-ci: the wake the platform delivered for PR 18 carries the same facts as REST, and does the same', async () => {
  const delivered = readFileSync(new URL('./evidence/delivered-wake-pr18.txt', import.meta.url), 'utf8');
  const sent = JSON.parse(delivered.match(/\{"check".*\}/)[0]);
  assert.deepEqual(sent, facts(run));
  const { host, handlers, builds } = await itemInVerifying();
  await offer(host, inputsOfWake(host, delivered), handlers);
  assert.equal(host.snapshot.value, 'building');
  assert.equal(host.snapshot.context.failure.check, 'test');
  assert.equal(builds[1].failure.check, 'test');
});
