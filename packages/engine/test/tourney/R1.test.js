// R1 Three parallel sub-questions, one researcher errors: the join does not hang; the report is verified against
// sources the host itself checked; it is published only after approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, gitRepo, fakeGitHub, platform, hostFor, makeEffects, agentReturns, offer, start, restore, openRun, tap, loadWorkflow, transitions, RELEASE } from './world.js';
import { childEvents } from '../../src/effects/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun, runDir } from '../../src/actors.js';
import { inputsOfWake } from '../../src/index.js';

const RESEARCH = loadWorkflow('research');
const RQ = loadWorkflow('research-question');
const SPECS = { 'research-question': RQ };
const QUESTION = { url: 'https://github.com/o/r/issues/9', expect: ['answers which merge queue fits, with sources'] };

function world({ sources = { 'https://a.example/1': 200, 'https://b.example/2': 200 } } = {}) {
  const repo = gitRepo();
  const plat = platform();
  const published = [];
  const fetched = [];
  const publisher = { publish: async ({ key, report }) => { published.push({ key, report }); return { url: `https://docs.example/${published.length}` }; } };
  const fetch = async (url) => { fetched.push(url); return { status: sources[url] ?? 404, body: `page ${url}` }; };
  return { repo, plat, published, fetched, publisher, fetch };
}

function parentFor(root, w, session = 'owner') {
  const childHandlers = (child) => makeEffects(child, { repo: w.repo, gh: null, plat: w.plat });
  return hostFor({ root, item: 'res-1', spec: RESEARCH, session, repo: w.repo, gh: null, plat: w.plat, publisher: w.publisher, fetch: w.fetch, specs: SPECS, childHandlers });
}
const children = (parent) => parent.effects.get(openRun(parent, 'start').id).outcome.children;
const childHost = (root, id, w) => {
  const host = restore({ root, item: id, spec: RQ, session: 'owner', release: RELEASE });
  return { host, effects: makeEffects(host, { repo: w.repo, gh: null, plat: w.plat }) };
};
const hear = (parent, effects) => offer(parent, childEvents(parent, SPECS), effects);
const workerFailed = (run) => `<task-notification>\n<task-id>${run}</task-id>\n<status>failed</status>\n</task-notification>`;

async function toReport(w, root) {
  const { host: parent, effects } = parentFor(root, w);
  await offer(parent, [start({ issue: QUESTION })], effects);
  await agentReturns(parent, 'plan', { questions: [{ question: 'q1' }, { question: 'q2' }, { question: 'q3' }] }, { effects });
  assert.equal(parent.snapshot.value, 'researching');
  const ids = children(parent);
  assert.equal(ids.length, 3, 'three researchers fan out as child items');
  // Researcher 1 answers; researcher 2's worker fails; researcher 3 answers.
  const [c1, c2, c3] = ids.map((id) => childHost(root, id, w));
  await agentReturns(c1.host, 'research', { finding: 'GitHub merge queue', sources: ['https://a.example/1'] }, { effects: c1.effects });
  await hear(parent, effects);
  await offer(c2.host, inputsOfWake(c2.host, workerFailed(openRun(c2.host, 'research').id)), c2.effects);
  assert.equal(c2.host.snapshot.value, 'failed');
  await hear(parent, effects);
  assert.equal(parent.snapshot.value, 'researching');
  await agentReturns(c3.host, 'research', { finding: 'bors', sources: ['https://b.example/2'] }, { effects: c3.effects });
  await hear(parent, effects);
  return { parent, effects };
}

test('R1: one researcher of three fails; the join completes, the failed sub-question is re-planned, the report is source-checked by the host, verified, and published only after approval', async () => {
  const w = world();
  const root = fresh();
  const { parent, effects } = await toReport(w, root);
  assert.deepEqual(parent.snapshot.context.fanout, { count: 3, finished: 3, failed: 1 }, 'the join counted the failure');
  assert.equal(parent.snapshot.value, 'planning', 'the join did not hang: it moved on, re-planning the failed sub-question');
  assert.equal(parent.snapshot.context.failure.kind, 'children');

  await agentReturns(parent, 'plan', { questions: [{ question: 'q2, narrower' }] }, { effects });
  const [again] = children(parent).map((id) => childHost(root, id, w));
  await agentReturns(again.host, 'research', { finding: 'trains', sources: ['https://b.example/2'] }, { effects: again.effects });
  await hear(parent, effects);
  assert.equal(parent.snapshot.value, 'synthesizing');

  await agentReturns(parent, 'synthesize', { report: 'Use the GitHub merge queue.', sources: ['https://a.example/1', 'https://b.example/2'] }, { effects });
  assert.deepEqual(w.fetched, ['https://a.example/1', 'https://b.example/2'], 'the host fetched every cited source itself');
  assert.equal(parent.snapshot.value, 'judging');
  assert.equal(parent.snapshot.context.checked.ok, true);
  assert.equal(openRun(parent, 'verify').input.subject, parent.snapshot.context.report.hash);
  // Round 2 graft (lane C): the host wrote the report blob into the verifier's worktree and told it where.
  const vrun = loadRun(root, openRun(parent, 'verify').id);
  assert.equal(readFileSync(join(vrun.worktree, '.ccp/subject'), 'utf8'), 'Use the GitHub merge queue.');
  assert.match(readFileSync(join(runDir(root, vrun.run), 'context.md'), 'utf8'), /The subject you judge is the file \.ccp\/subject/);

  await agentReturns(parent, 'verify', { result: 'PASS', report: 'claims match sources' }, { effects });
  assert.equal(parent.snapshot.value, 'asking');
  assert.equal(parent.snapshot.context.verdict.subject, parent.snapshot.context.report.hash, 'the verdict binds to the report blob the host handed the verifier');
  assert.deepEqual(w.published, [], 'not published before approval');

  await tap(parent, { effects, index: 0 });
  assert.equal(parent.snapshot.value, 'done');
  assert.deepEqual(w.published.map((p) => p.report), [parent.snapshot.context.report.hash]);
  assert.equal(parent.snapshot.context.published.url, 'https://docs.example/1');
  const states = transitions(root, 'res-1').filter((r) => r.payload.outcome === 'applied').sort((a, b) => a.payload.seq - b.payload.seq).map((r) => r.state);
  assert.ok(states.indexOf('"publishing"') > states.indexOf('"asking"'));
});

test('R1: rejecting the report never publishes it', async () => {
  const w = world();
  const root = fresh();
  const { parent, effects } = await toReport(w, root);
  await agentReturns(parent, 'plan', { questions: [{ question: 'q2' }] }, { effects });
  const [again] = children(parent).map((id) => childHost(root, id, w));
  await agentReturns(again.host, 'research', { finding: 'x', sources: [] }, { effects: again.effects });
  await hear(parent, effects);
  await agentReturns(parent, 'synthesize', { report: 'r', sources: ['https://a.example/1'] }, { effects });
  await agentReturns(parent, 'verify', { result: 'PASS', report: 'ok' }, { effects });
  await tap(parent, { effects, index: 1 });
  assert.equal(parent.snapshot.value, 'replanning');
  assert.deepEqual(w.published, []);
});

test('R1: a report citing a source the host cannot fetch is never judged or published', async () => {
  const w = world();
  const root = fresh();
  const { parent, effects } = await toReport(w, root);
  await agentReturns(parent, 'plan', { questions: [{ question: 'q2' }] }, { effects });
  const [again] = children(parent).map((id) => childHost(root, id, w));
  await agentReturns(again.host, 'research', { finding: 'x', sources: [] }, { effects: again.effects });
  await hear(parent, effects);
  await agentReturns(parent, 'synthesize', { report: 'r', sources: ['https://a.example/1', 'https://invented.example/9'] }, { effects });
  assert.equal(parent.snapshot.value, 'replanning');
  assert.equal(parent.snapshot.context.failure.kind, 'sources');
  assert.equal(openRun(parent, 'verify'), null);
  assert.deepEqual(w.published, []);
});
