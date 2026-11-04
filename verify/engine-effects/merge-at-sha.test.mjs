// Expect merge-at-sha (world). world/merge-at-sha.mjs ran a real quick-fix item with the real host and the real GitHub
// REST client against scratch PRs and saved evidence/merge-*.json and the item journals. This test checks that evidence
// offline (journal rows included, so the evidence is not just the script's own summary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from '../../packages/journal/src/index.js';

const ev = (n) => JSON.parse(readFileSync(new URL(`./evidence/${n}.json`, import.meta.url), 'utf8'));
const journal = (n) => readFile(new URL(`./evidence/${n}.journal.jsonl`, import.meta.url).pathname).rows;
const effects = (n) => journal(n).filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge');

test('stale: a commit B pushed after the PASS at A -> merge sent expectedHeadSha A, GitHub refused (409), PR #17 stays open', () => {
  const e = ev('merge-stale');
  assert.equal(e.pr, 'suredesigntshirts/ccp_xstate_scratch#17');
  assert.match(e.commitA, /^[0-9a-f]{40}$/); assert.match(e.commitB, /^[0-9a-f]{40}$/);
  assert.notEqual(e.commitA, e.commitB);
  assert.equal(e.mergeCalls.length, 1);
  assert.equal(e.mergeCalls[0].args.expectedHeadSha, e.commitA);
  assert.deepEqual([e.mergeCalls[0].result.ok, e.mergeCalls[0].result.status], [false, 409]);
  assert.deepEqual(e.prAfter, { state: 'open', merged: false, head: e.commitB });
});

test('stale: the journal shows the verdict at A, then a merge effect that started and failed, and the item stepped back', () => {
  const e = ev('merge-stale');
  const rows = journal('merge-stale');
  const verdict = rows.find((r) => r.kind === 'engine.transition' && r.payload.event?.output?.result === 'PASS');
  assert.equal(verdict.payload.event.output.sha, e.commitA);
  const m = effects('merge-stale');
  assert.deepEqual(m.map((r) => r.payload.phase), ['start', 'failed']);
  assert.match(m[1].payload.reason, new RegExp(`at ${e.commitA}: Head branch was modified`));
  assert.ok(m[1].payload.reason.includes(e.commitB), 'the failure names the head GitHub has now');
  assert.equal(e.finalState, 'replanning');
  assert.ok(!rows.some((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge' && r.payload.phase === 'done'));
});

test('control: with no push, the same flow merges PR #15 at A and the merge effect journals done with the merge sha', () => {
  const e = ev('merge-control');
  assert.equal(e.mergeCalls[0].args.expectedHeadSha, e.commitA);
  assert.equal(e.mergeCalls[0].result.ok, true);
  assert.deepEqual(e.prAfter, { state: 'closed', merged: true, head: e.commitA });
  assert.equal(e.finalState, 'done');
  const m = effects('merge-control');
  assert.deepEqual(m.map((r) => r.payload.phase), ['start', 'done']);
  assert.equal(m[1].payload.outcome.head, e.commitA);
  assert.equal(m[1].payload.outcome.sha, e.mergeCalls[0].result.sha);
});
