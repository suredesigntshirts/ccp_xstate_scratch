// R1 three parallel sub-questions, one researcher errors: the join does not hang; the report is verified against
// sources the host itself checked; it is published only after approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemWorld, offer, startEvent, briefReturns, agentOf, deliver, wake, taskFailed, openRun, openRuns, tap, pages, pending } from './world.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const QUESTION = { text: 'Which sort is stable in V8?', expect: ['names the sort V8 uses', 'cites the V8 source'] };
const BRIEFS = { q1: 'What sort does V8 use?', q2: 'Since when?', q3: 'Is it stable?', synthesizer: 'Write the report.', verifier: 'Check the report against its sources.' };
const PAGES = {
  '/v8-sort': '<html><body><p>V8 uses <b>TimSort</b> for Array.prototype.sort since 7.0.</p></body></html>',
  '/stable': '<html><body><p>Array.prototype.sort is   stable as of ES2019.</p></body></html>'
};

async function toSynthesizing() {
  const web = await pages(PAGES);
  const w = await itemWorld({ workflow: 'research' });
  w.fetch = web.fetch;
  const close = w.close;
  w.close = async () => { await close(); await web.close(); };
  await offer(w.host, [startEvent({ question: QUESTION })], w.handlers);
  await briefReturns(w, BRIEFS);
  return w;
}

test('R1: the join fires with one failed researcher, the report is verified by digest against host-fetched sources, and it is posted only after the publish tap', async () => {
  const w = await toSynthesizing();
  try {
    assert.deepEqual(w.host.snapshot.value, { researching: { r1: 'running', r2: 'running', r3: 'running' } });
    const runs = openRuns(w.host).filter((r) => r.actor === 'research');
    assert.deepEqual(runs.map((r) => r.invoke).sort(), ['r1', 'r2', 'r3']);
    const transitions = new Set(runs.map((r) => w.host.effects.get(r.id).effect.transition));
    assert.equal(transitions.size, 1, 'three run effects from one transition');

    const r1 = agentOf(w, 'r1');
    assert.match(r1.context, /Cite every source as \{ "url", "quote" \}/);
    assert.ok((await r1.ret({ answer: 'TimSort', sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses TimSort' }] })).accepted);
    await deliver(w);
    const r2run = openRun(w.host, 'r2');
    await wake(w, taskFailed(r2run.id), new Date().toISOString()); // now: no research timer is due yet
    assert.deepEqual(w.host.snapshot.value, { researching: { r1: 'ended', r2: 'ended', r3: 'running' } }, 'the join waits for r3');
    const r3 = agentOf(w, 'r3');
    assert.ok((await r3.ret({ answer: 'Stable since ES2019', sources: [{ url: 'https://src.test/stable', quote: 'sort is stable as of ES2019' }] })).accepted);
    await deliver(w);

    assert.equal(w.host.snapshot.value, 'synthesizing', 'the join completed with one failed child');
    assert.equal(w.host.snapshot.context.errors.q2, 'the worker failed');
    assert.equal(w.host.snapshot.context.answers.q2, null);
    assert.equal(w.host.snapshot.context.answers.q1.attested.sources[0].digest, sha256(PAGES['/v8-sort']));

    // The synthesizer cites a quote that is not on the page: refused. Then it cites true quotes.
    const syn = agentOf(w, 'synthesize');
    const bad = await syn.ret({ report: '# Report\nV8 uses QuickSort.', sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses QuickSort' }] });
    assert.equal(bad.refused?.rule, 'source');
    const report = '# Report\nV8 uses TimSort, and sort is stable as of ES2019.';
    const good = await syn.ret({ report, sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses TimSort' }, { url: 'https://src.test/stable', quote: 'sort is stable as of ES2019' }] });
    assert.ok(good.accepted, JSON.stringify(good));
    await deliver(w);
    assert.equal(w.host.snapshot.value, 'verifying');
    const r = w.host.snapshot.context.report;
    assert.deepEqual(r.attested.sources.map((s) => s.digest), [sha256(PAGES['/v8-sort']), sha256(PAGES['/stable'])]);

    // The verifier gets the report by digest and the host's copies of the sources, in its worktree.
    const verify = openRun(w.host, 'verify');
    assert.equal(verify.input.subject, r.attested.digest);
    assert.deepEqual(verify.input.sources.map((s) => s.digest), r.attested.sources.map((s) => s.digest));
    const v = agentOf(w, 'verify');
    const wt = v.run.worktree;
    assert.equal(sha256(readFileSync(join(wt, '.ccp', 'subject'))), r.attested.digest);
    for (const s of r.attested.sources) assert.equal(readFileSync(join(wt, '.ccp', 'blobs', s.digest), 'utf8'), PAGES[new URL(s.url).pathname]);
    assert.match(v.context, new RegExp(`What you are judging is the file \\.ccp/subject \\(sha256 ${r.attested.digest}\\)`));
    assert.ok((await v.ret({ result: 'PASS', report: 'Both claims are on the fetched pages.' })).accepted);
    await deliver(w);
    assert.equal(w.host.snapshot.context.verdict.attested.subject, r.attested.digest);
    assert.equal(w.host.snapshot.value, 'awaitingPublish');
    assert.equal(w.plat.posts.length, 0, 'nothing is published before the approval');
    assert.deepEqual(w.plat.cards.map((c) => c.choices), [['publish', 'reject']]);

    await tap(w, 0);
    assert.equal(w.host.snapshot.value, 'done');
    assert.equal(w.plat.posts.length, 1);
    assert.equal(w.plat.posts[0].text, report);
    assert.equal(w.plat.cards.length, 1, 'one tap');
  } finally {
    await w.close();
  }
});

test('R1: a PASS from a verifier that edited the report it judges does not count', async () => {
  const w = await toSynthesizing();
  try {
    for (const q of ['r1', 'r2', 'r3']) {
      const a = agentOf(w, q);
      assert.ok((await a.ret({ answer: 'TimSort', sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses TimSort' }] })).accepted);
    }
    await deliver(w);
    assert.equal(w.host.snapshot.value, 'synthesizing');
    const syn = agentOf(w, 'synthesize');
    assert.ok((await syn.ret({ report: '# R\nTimSort.', sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses TimSort' }] })).accepted);
    await deliver(w);
    // A verifier that rewrites the report it judges: its PASS is for another digest.
    const v = agentOf(w, 'verify');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(v.run.worktree, '.ccp', 'subject'), '{"report":"something better"}');
    assert.ok((await v.ret({ result: 'PASS', report: 'fine' })).accepted);
    await deliver(w);
    assert.notEqual(w.host.snapshot.value, 'awaitingPublish');
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.equal(w.plat.posts.length, 0);
  } finally {
    await w.close();
  }
});

test('R1: publish needs the approval: reject on the publish card posts nothing', async () => {
  const w = await toSynthesizing();
  try {
    for (const q of ['r1', 'r2', 'r3']) {
      assert.ok((await agentOf(w, q).ret({ answer: 'TimSort', sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses TimSort' }] })).accepted);
    }
    await deliver(w);
    assert.ok((await agentOf(w, 'synthesize').ret({ report: '# R\nTimSort.', sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses TimSort' }] })).accepted);
    await deliver(w);
    assert.ok((await agentOf(w, 'verify').ret({ result: 'PASS', report: 'fine' })).accepted);
    await deliver(w);
    assert.equal(w.host.snapshot.value, 'awaitingPublish');
    await tap(w, 1);
    assert.equal(w.host.snapshot.value, 'replanning');
    assert.equal(w.plat.posts.length, 0);
    assert.equal(pending(w.host).runs.filter((r) => r.actor === 'post').length, 0);
  } finally {
    await w.close();
  }
});

test('R1: a researcher that never returns times out, and the join still fires', async () => {
  const w = await toSynthesizing();
  try {
    assert.ok((await agentOf(w, 'r1').ret({ answer: 'TimSort', sources: [{ url: 'https://src.test/v8-sort', quote: 'V8 uses TimSort' }] })).accepted);
    await deliver(w);
    await wake(w, taskFailed(openRun(w.host, 'r2').id), new Date().toISOString());
    assert.deepEqual(w.host.snapshot.value, { researching: { r1: 'ended', r2: 'ended', r3: 'running' } });
    // r3's agent never returns. An hour and more later, any wake fires its timer.
    const later = new Date(Date.now() + 2 * 3600000).toISOString();
    await wake(w, `<wake reason="scheduled" current-time="${later}">\n</wake>`, later);
    assert.equal(w.host.snapshot.value, 'synthesizing');
    assert.equal(w.host.snapshot.context.errors.r3 ?? w.host.snapshot.context.errors.q3, 'timed out');
  } finally {
    await w.close();
  }
});
