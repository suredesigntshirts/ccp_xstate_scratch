// Verifier test for host-merges (plan item engine-cards-standin): reads the committed evidence of the verifier's own
// scratch run (item sa-cards1, scratch PR #28, issue #27) and GitHub's record of the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E = join(dirname(fileURLToPath(import.meta.url)), 'evidence');
const rows = readFileSync(join(E, 'item-sa-cards1.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pr = JSON.parse(readFileSync(join(E, 'github-pr-28.json'), 'utf8'));
const transitions = rows.filter((r) => r.kind === 'engine.transition');

test('host-merges: the ask is answered by a stand-in under the grant, then the host merges at the verdict sha', () => {
  const verify = transitions.find((r) => r.payload.event.type === 'xstate.done.actor.verify').payload.event.output;
  const ask = transitions.find((r) => r.payload.event.type === 'xstate.done.actor.ask');
  assert.equal(ask.payload.outcome, 'applied');
  assert.equal(ask.source.system, 'standin');
  assert.match(ask.source.ref, /^2026-10-31-away-4h cmsg_/);
  assert.equal(ask.payload.event.output.grant, '2026-10-31-away-4h');
  assert.match(ask.payload.event.output.by, /#agent=verifier-cards-standin$/);
  const done = rows.find((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge' && r.payload.phase === 'done');
  assert.equal(done.payload.outcome.head, verify.sha);
  assert.equal(done.payload.outcome.sha, pr.merge_commit_sha);
  const merged = transitions.at(-1);
  assert.equal(merged.source.system, 'engine');
  assert.equal(merged.payload.event.type, 'xstate.done.actor.merge');
  assert.ok(transitions.indexOf(ask) < transitions.indexOf(merged));
});

test('host-merges: GitHub shows PR 28 merged, its head the verdict sha', () => {
  const verify = transitions.find((r) => r.payload.event.type === 'xstate.done.actor.verify').payload.event.output;
  assert.equal(verify.result, 'PASS');
  assert.equal(pr.merged, true);
  assert.equal(pr.head.sha, verify.sha);
  assert.equal(pr.merge_commit_sha, '4ae770b0cda2dc2cb38fddcc0336debd7f4451bc');
});
