// R1 Research: three parallel sub-questions, one researcher errors: the join does not hang; the report is verified
// against sources the host itself checked; it is published only after approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { world, fakeWeb, attested, returned, errored, tap, openRunOf, loadWorkflow, inputsOfWakeFor, timeWake, blobPath, fileExists } from './world.js';

const research = () => loadWorkflow('research');
const PAGES = {
  '/a': '<p>Node 22   was released\n in April 2024.</p>',
  '/b': '<p>XState 5 has a pure transition() function.</p>',
  '/c': '<p>JSON Schema has a $ref keyword.</p>'
};
const PLAN = { questions: ['When was Node 22 released?', 'Does XState 5 have pure transitions?', 'Does JSON Schema have refs?'], writer: 'write the report', verifier: 'check every claim against its source' };

async function fanned(w) {
  let { host } = await w.startItem('r-1', { question: 'What does the engine stand on?' }, research());
  assert.equal(host.snapshot.value, 'planning', 'a root plans');
  ({ host } = await w.send('r-1', [returned(host, 'plan', PLAN)], research()));
  assert.equal(host.snapshot.value, 'fanning');
  const run = openRunOf(host, 'answers');
  const leaf = (k) => `${run.id.replace(':', '~')}.${k}`;
  for (let k = 0; k < 3; k++) {
    const l = w.open(leaf(k), research());
    assert.equal(l.snapshot.value, 'answering', `leaf ${k} started in parallel and routed to answering`);
    assert.deepEqual(l.snapshot.context.facts.input.v, { question: PLAN.questions[k], leaf: true });
  }
  return { leaf };
}

async function answer(w, web, id, path, quote) {
  const l = w.open(id, research());
  const got = await attested(l, 'answer', { text: `answer from ${path}`, sources: [{ url: web.url(path), quote }] }, { web });
  assert.ok(got.input, JSON.stringify(got.refused));
  const { host } = await w.send(id, [got.input], research());
  return host;
}

test('R1 one leaf errors: the join completes {3, 2}; the report is verified against the host\'s own copies of its sources; it is posted only after the publish tap', async () => {
  const web = await fakeWeb(PAGES);
  try {
    const w = world({});
    const { leaf } = await fanned(w);
    assert.equal((await answer(w, web, leaf(0), '/a', 'Node 22 was released in April 2024.')).snapshot.value, 'done');
    let l1 = w.open(leaf(1), research());
    ({ host: l1 } = await w.send(leaf(1), [errored(l1, 'answer', 'the researcher crashed')], research()));
    assert.equal(l1.snapshot.value, 'failed');
    assert.equal((await answer(w, web, leaf(2), '/c', 'JSON Schema has a $ref keyword.')).snapshot.value, 'done');

    let adv = await w.advance('r-1', research());
    assert.equal(adv.inputs.length, 1, 'the join completes with one failed child');
    const joined = adv.inputs[0].event.output;
    assert.deepEqual([joined.total, joined.done], [3, 2]);
    assert.deepEqual(joined.items.map((i) => i.state), ['done', 'failed', 'done']);
    assert.equal(joined.found[0].sources[0].blob.length, 64, 'each found answer carries the host\'s source copies');
    let root = adv.host;
    assert.equal(root.snapshot.value, 'composing');

    // A report citing a quote that is not on its page is refused.
    const bad = await attested(root, 'report', { text: 'report', sources: [{ url: web.url('/b'), quote: 'XState 5 runs actors in the transition.' }] }, { web });
    assert.equal(bad.refused?.rule, 'source-fact');

    const REPORT = { text: 'Node 22 (April 2024) and JSON Schema $ref.', sources: [{ url: web.url('/a'), quote: 'Node 22 was released in April 2024.' }, { url: web.url('/c'), quote: 'JSON Schema has a $ref keyword.' }] };
    const good = await attested(root, 'report', REPORT, { web });
    ({ host: root } = await w.send('r-1', [good.input], research()));
    assert.equal(root.snapshot.value, 'verifying');
    const verify = w.agents.started.filter((e) => e.actor === 'verify' && e.id.startsWith('r-1:')).at(-1);
    assert.equal(verify.input.sources.length, 2);
    for (const s of verify.input.sources) {
      assert.ok(existsSync(blobPath(w.root, s.blob)), 'the verifier gets the host\'s stored copy');
      const path = new URL(s.url).pathname;
      assert.equal(readFileSync(blobPath(w.root, s.blob), 'utf8'), PAGES[path], 'which is the page the host fetched');
    }

    ({ host: root } = await w.send('r-1', [returned(root, 'verify', { result: 'PASS', report: 'every claim is on its page' })], research()));
    assert.equal(root.snapshot.value, 'awaitingApproval');
    assert.deepEqual(w.plat.posts, [], 'nothing is published before approval');
    assert.equal(w.plat.cards.length, 1);
    ({ host: root } = await w.send('r-1', tap(root, 'approval', 0), research())); // publish
    assert.equal(root.snapshot.value, 'done');
    assert.equal(w.plat.posts.length, 1);
    assert.equal(w.plat.posts[0].text, REPORT.text);
    assert.equal(root.snapshot.output.published.ref, w.plat.posts[0].ref);
    assert.equal(w.plat.cards.length, 1, 'one tap');
  } finally {
    await web.close();
  }
});

test('R1 publish needs approval: a reject tap posts nothing', async () => {
  const web = await fakeWeb(PAGES);
  try {
    const w = world({});
    const { leaf } = await fanned(w);
    for (const [k, p, q] of [[0, '/a', 'Node 22 was released in April 2024.'], [1, '/b', 'XState 5 has a pure transition() function.'], [2, '/c', 'JSON Schema has a $ref keyword.']]) await answer(w, web, leaf(k), p, q);
    let { host: root } = await w.advance('r-1', research());
    const rep = await attested(root, 'report', { text: 'r', sources: [{ url: web.url('/b'), quote: 'XState 5 has a pure transition() function.' }] }, { web });
    ({ host: root } = await w.send('r-1', [rep.input], research()));
    ({ host: root } = await w.send('r-1', [returned(root, 'verify', { result: 'PASS', report: 'ok' })], research()));
    ({ host: root } = await w.send('r-1', tap(root, 'approval', 1), research())); // reject
    assert.equal(root.snapshot.value, 'replanning');
    assert.deepEqual(w.plat.posts, []);
    // Nor can a publishing state be reached on an answer that is not "publish": the post never ran.
    assert.equal(root.snapshot.context.facts.published, undefined);
  } finally {
    await web.close();
  }
});

test('R1 a leaf that never returns times out and the join still completes', async () => {
  const web = await fakeWeb(PAGES);
  try {
    const w = world({});
    const { leaf } = await fanned(w);
    await answer(w, web, leaf(0), '/a', 'Node 22 was released in April 2024.');
    await answer(w, web, leaf(2), '/c', 'JSON Schema has a $ref keyword.');
    assert.deepEqual((await w.advance('r-1', research())).inputs, [], 'the join waits while a leaf is open');
    let l1 = w.open(leaf(1), research());
    ({ host: l1 } = await w.send(leaf(1), inputsOfWakeFor(l1, timeWake('2998-01-01T00:00:00Z')), research()));
    assert.equal(l1.snapshot.value, 'failed');
    const adv = await w.advance('r-1', research());
    assert.deepEqual([adv.inputs[0].event.output.total, adv.inputs[0].event.output.done], [3, 2]);
    assert.equal(adv.host.snapshot.value, 'composing');
    assert.ok(fileExists(w.root, leaf(1)));
  } finally {
    await web.close();
  }
});
