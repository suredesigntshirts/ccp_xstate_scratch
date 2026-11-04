// R1 three parallel sub-questions, one researcher errors: the join does not hang; the report is verified against
// sources the host itself checked; it is published only after approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { actors, accept, bind, deliver, spawn, resultsOf, runDir } from '../../src/actors.js';
import { inputsOfWake } from '../../src/index.js';
import { agents, fakeWeb, fresh, gitRepo, handlers, loadWorkflow, offer, open, openRun, pending, platform, rows, start, tap, world } from './world-b.js';

const spec = loadWorkflow('research');
const QUESTION = { text: 'Which XState version added setup()?', expect: ['names the version', 'cites the changelog'] };
const PAGE_URL = 'https://example.org/changelog';
const PAGE = '<html><body><h1>Changelog</h1><p>XState <b>v5.0.0</b> adds the   setup() function.</p></body></html>';
const QUOTE = 'XState v5.0.0 adds the setup() function.';
const web = fakeWeb({ [PAGE_URL]: PAGE });
const startAgent = (root, run, agentId) => {
  spawn({ root, prompt: `ccp-run ${run}`, toolUseId: `toolu_${agentId}` });
  bind({ root, agentId, toolUseId: `toolu_${agentId}` });
};
const taskWake = (id, status) => `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>`;

test('R1: three researchers, one fails; the join completes, every cited source is host-checked, and publish waits for the tap', async () => {
  const repo = gitRepo();
  const root = fresh('r1');
  const worktrees = join(root, 'wt');
  let host = open(root, spec, { session: 's' });
  await offer(host, [start({ question: QUESTION }, 's')], handlers({ actors: actors({ host, repo, worktrees }) }));
  const brief = openRun(host, 'brief').id;
  startAgent(root, brief, 'ag-brief');
  assert.ok((await accept({ root, caller: 'ag-brief', run: brief, result: { q0: 'when?', q1: 'which API?', q2: 'which docs?', verifier: 'check every claim against its source' }, web })).accepted);
  assert.equal((await deliver({ root, run: brief })).state, 'researching');

  host = open(root, spec, { session: 's' });
  const research = pending(host).runs.filter((r) => r.actor === 'research');
  assert.deepEqual(research.map((r) => r.invoke).sort(), ['q0', 'q1', 'q2'], 'three research runs open at once');
  const [q0, q1, q2] = ['q0', 'q1', 'q2'].map((id) => research.find((r) => r.invoke === id).id);
  // The researcher's prompt names its own sub-question and the host's quote check; its context lists only that check.
  const prompt = (run, file) => readFileSync(join(runDir(root, run), file), 'utf8');
  assert.match(prompt(q1, 'brief.md'), /^Answer the sub-question "which API\?" \(part of: "Which XState version added setup\(\)\?"\)\. Cite every claim as \{url, quote\}/);
  assert.match(prompt(q1, 'context.md'), /every \{url, quote\} must be on the page when the host fetches that url itself/);
  assert.doesNotMatch(prompt(q1, 'context.md'), /ciChanged|worktree's HEAD/, 'a researcher is not told about checks its result cannot trigger');

  // q0 answers with a source the host fetches and finds the quote on.
  startAgent(root, q0, 'ag-q0');
  const unseen = await accept({ root, caller: 'ag-q0', run: q0, result: { answer: 'v5', sources: [{ url: PAGE_URL, quote: 'XState v4 adds setup()' }] }, web });
  assert.equal(unseen.refused?.rule, 'source-unseen', 'a quote not on the fetched page is refused');
  assert.deepEqual(resultsOf(open(root, spec, { session: 's' })), []);
  assert.ok((await accept({ root, caller: 'ag-q0', run: q0, result: { answer: 'v5', sources: [{ url: PAGE_URL, quote: QUOTE }] }, web })).accepted);
  assert.equal((await deliver({ root, run: q0 })).state, 'researching');

  // q1's worker fails (a task notification).
  host = open(root, spec, { session: 's' });
  const failed = inputsOfWake(host, taskWake(q1, 'failed'));
  assert.equal(failed.length, 1);
  await offer(host, failed, handlers({ actors: actors({ host, repo, worktrees }) }));
  assert.equal(host.snapshot.value, 'researching', 'still waiting on q2');
  assert.equal(host.snapshot.context.answers.q1.kind, 'actor');

  // q2 answers: the last slot fills and the join leaves.
  startAgent(root, q2, 'ag-q2');
  assert.ok((await accept({ root, caller: 'ag-q2', run: q2, result: { answer: 'setup()', sources: [{ url: PAGE_URL, quote: 'adds the setup() function' }] }, web })).accepted);
  assert.equal((await deliver({ root, run: q2 })).state, 'synthesizing', 'the join completed with one failed child');

  host = open(root, spec, { session: 's' });
  const synth = openRun(host, 'synthesize').id;
  // The synthesizer is told the failed sub-answer is a gap to name, not to fill.
  assert.match(prompt(synth, 'brief.md'), /A sub-answer of the form \{"kind": "actor"\} failed: name that gap in the report, and do not fill it with claims you cannot cite/);
  assert.match(prompt(synth, 'context.md'), /"q1":\{"kind":"actor"/);
  startAgent(root, synth, 'ag-synth');
  const fake = await accept({ root, caller: 'ag-synth', run: synth, result: { report: 'v5 added setup()', sources: [{ url: 'https://example.org/nowhere', quote: QUOTE }] }, web });
  assert.equal(fake.refused?.rule, 'source-unseen', 'a source the host cannot fetch is refused');
  const REPORT = 'XState v5.0.0 added setup().';
  assert.ok((await accept({ root, caller: 'ag-synth', run: synth, result: { report: REPORT, sources: [{ url: PAGE_URL, quote: QUOTE }] }, web })).accepted);
  assert.equal((await deliver({ root, run: synth })).state, 'verifying');
  const seen = rows(root).filter((r) => r.kind === 'source.seen');
  assert.ok(seen.length >= 3 && seen.every((r) => r.payload.url === PAGE_URL && r.payload.blob), 'every accepted source was fetched by the host');

  host = open(root, spec, { session: 's' });
  const verify = openRun(host, 'verify');
  assert.equal(verify.input.report.report, REPORT);
  assert.deepEqual(verify.input.report.sources, [{ url: PAGE_URL, quote: QUOTE }], 'the verifier gets only host-checked sources');
  // The research verifier gets the planner's verifier brief, the acceptance lines and the independent-grader role.
  assert.equal(prompt(verify.id, 'brief.md'), 'check every claim against its source');
  assert.match(prompt(verify.id, 'context.md'), /Acceptance lines [^\n]*\n {2}1\. names the version\n {2}2\. cites the changelog/);
  assert.match(prompt(verify.id, 'context.md'), /Your role: You did not write what you grade, and you get no notes from its author/);
  assert.match(prompt(verify.id, 'context.md'), /a brief another agent wrote for this run\. Where it conflicts with the acceptance lines/);
  startAgent(root, verify.id, 'ag-verify');
  assert.ok((await accept({ root, caller: 'ag-verify', run: verify.id, result: { result: 'PASS', report: 'every claim matches its source' }, web })).accepted);
  assert.equal((await deliver({ root, run: verify.id })).state, 'awaitingApproval');

  const plat = platform();
  host = open(root, spec, { session: 's' });
  const fx = world({ plat, actors: actors({ host, repo, worktrees }) });
  await offer(host, [], fx); // the card goes up
  assert.equal(plat.cards.length, 1);
  assert.deepEqual(plat.cards[0].choices, ['publish', 'reject']);
  assert.equal(plat.posts.length, 0, 'nothing is published before approval');
  await offer(host, tap(host, 0), fx);
  assert.equal(host.snapshot.value, 'published');
  assert.deepEqual(plat.posts.map((p) => p.text), [REPORT]);
  assert.equal(open(root, spec, { session: 's' }).snapshot.value, 'published', 'the journal replays to published');
});

test('R1: a researcher that never returns is bounded by researchTimeout; the join does not hang', async () => {
  const plat = platform();
  const root = fresh('r1t');
  const host = open(root, spec);
  const src = [{ url: PAGE_URL, quote: QUOTE }];
  const a = agents({ brief: [{ q0: 'a', q1: 'b', q2: 'c', verifier: 'v' }], research: [{ answer: 'A', sources: src }, { answer: 'B', sources: src }, null], synthesize: [null] });
  const fx = world({ plat, actors: a.byActor });
  await offer(host, [start({ question: QUESTION })], fx);
  assert.equal(host.snapshot.value, 'researching');
  const due = inputsOfWake(host, '<wake reason="scheduled" current-time="2999-01-01T00:00:00Z">\n</wake>', { now: '2999-01-01T00:00:00Z' });
  assert.equal(due.length, 1);
  await offer(host, due, fx);
  assert.equal(host.snapshot.value, 'synthesizing');
  assert.equal(host.snapshot.context.failure.kind, 'timeout');
  assert.equal(plat.posts.length, 0);
});
