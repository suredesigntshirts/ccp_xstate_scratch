// Q1 happy path: issue -> brief -> build -> verify PASS -> CI green -> person approves -> merged at the verified head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWorld, offer, startEvent, ISSUE, briefReturns, builderReturns, verifierReturns, deliver, wake, checkSuite, tap, openRun } from './world.js';

test('Q1: one tap merges the PR at the verified head, and done needs merge.head == the verified subject', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    assert.equal(w.host.snapshot.value, 'briefing');
    await briefReturns(w);
    assert.equal(w.host.snapshot.value, 'building');
    const b = await builderReturns(w);
    assert.ok(b.got.accepted, JSON.stringify(b.got));
    await deliver(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });
    assert.equal(w.host.snapshot.context.pr.ref, 'o/r#1');
    assert.equal(w.host.snapshot.context.pr.branch, 'ccp/it-1/1');
    assert.equal(w.host.snapshot.context.pr.head, b.head);
    const verify = openRun(w.host, 'verify');
    assert.equal(verify.input.subject, b.head, 'the verifier judges the attested head');
    const v = await verifierReturns(w);
    assert.ok(v.got.accepted, JSON.stringify(v.got));
    await deliver(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'waitingCi' });
    await wake(w, checkSuite(b.head));
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    assert.equal(w.plat.cards.length, 1);
    assert.equal(w.gh.merges.length, 0, 'nothing merges before the tap');
    await tap(w, 0);
    assert.equal(w.host.snapshot.value, 'done');
    assert.equal(w.host.snapshot.status, 'done');
    assert.deepEqual(w.gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: b.head }]);
    assert.equal(w.host.snapshot.context.merge.head, w.host.snapshot.context.verdict.attested.subject);
    assert.equal(w.plat.cards.length, 1, 'one person tap on the happy path');
    assert.ok(w.host.spec.id.match(/^quick-fix@[0-9a-f]{64}$/));
  } finally {
    await w.close();
  }
});

test('Q1 variant: CI green arrives before the verdict, and the item still goes straight to awaitingMerge', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w);
    const b = await builderReturns(w);
    await deliver(w);
    await wake(w, checkSuite(b.head));
    assert.deepEqual(w.host.snapshot.value, { gated: 'verifying' });
    await verifierReturns(w);
    await deliver(w);
    assert.deepEqual(w.host.snapshot.value, { gated: 'awaitingMerge' });
    await tap(w, 0);
    assert.equal(w.host.snapshot.value, 'done');
    assert.deepEqual(w.gh.merges.map(({ number, sha }) => ({ number, sha })), [{ number: 1, sha: b.head }]);
    assert.equal(w.plat.cards.length, 1);
  } finally {
    await w.close();
  }
});
