// The host's effects (plan item engine-effects): merge, card, post and timer, each run once per effect id.
//
// no-bash: before anything in this file loads the effects, every child_process function and the mod API's
// $.process are wrapped to count calls, so a shell command from an effect, from code it calls outside effects/, or
// from a dynamic import, is counted. The last test asserts the count is zero.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shells = [];
const childProcess = createRequire(import.meta.url)('node:child_process');
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const real = childProcess[name];
  childProcess[name] = function (...args) {
    shells.push({ name, args: args.slice(0, 2) });
    return real.apply(this, args);
  };
}
syncBuiltinESMExports();
const hadDollar = 'globalThis' in globalThis && '$' in globalThis;
const dollar = globalThis.$;
globalThis.$ = { ...(dollar ?? {}), process: (...args) => { shells.push({ name: '$.process', args }); return null; } };
after(() => { if (hadDollar) globalThis.$ = dollar; else delete globalThis.$; });

const { restore, offer, pending, persist, runEffects } = await import('../src/index.js');
const { handlers, github, prRef } = await import('../src/effects/index.js');
const { readFile } = await import('../../journal/src/index.js');
const { workflow, ISSUE, BRIEFS, A, B, done, pr, verdict } = await import('./flow.js');

const URL_ = 'https://github.com/o/r/pull/1';

// A GitHub that holds one open PR at a head, merges only at that head (as the REST API does with sha), and can be
// pushed to. Served over HTTP so the real client in effects/github.js is what talks to it.
async function fakeGitHub(head) {
  const state = { head, merged: false, mergeSha: null, merges: [], pushes: 0 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.url !== '/repos/o/r/pulls/1' && req.url !== '/repos/o/r/pulls/1/merge') return reply(404, { message: 'Not Found' });
      if (req.method === 'GET') return reply(200, { number: 1, merged: state.merged, merge_commit_sha: state.mergeSha, head: { sha: state.head } });
      const { sha, merge_method } = JSON.parse(body || '{}');
      state.merges.push({ sha, merge_method });
      if (state.merged) return reply(405, { message: 'Pull Request is not mergeable' });
      if (sha && sha !== state.head) return reply(409, { message: 'Head branch was modified. Review and try the merge again.' });
      state.merged = true;
      state.mergeSha = 'd'.repeat(40);
      return reply(200, { sha: state.mergeSha, merged: true, message: 'Pull Request successfully merged' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const client = github({ api: `http://127.0.0.1:${server.address().port}`, env: {} });
  return { state, client, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

// An item of quick-fix taken to merging at head, with the person's approval.
async function toMerging(root, head, effects) {
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  const outputs = { brief: BRIEFS, build: pr(head), verify: verdict('PASS', head), ask: { choice: 'approve', by: 'person' } };
  const actors = Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, { start: async (e) => ({ ref: e.id, output }) }]));
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 's' } }],
    handlers({ ...effects, actors: { ...actors, ...(effects.actors ?? {}) } }));
  return host;
}
const effectRows = (root) => readFile(join(root, 'items', 'it-1.jsonl')).rows.filter((r) => r.kind === 'engine.effect');
const fresh = () => mkdtempSync(join(tmpdir(), 'engine-effects-'));

test('prRef reads owner, repo and number from a PR URL, and nothing else', () => {
  assert.deepEqual(prRef('https://github.com/suredesigntshirts/ccp_xstate_scratch/pull/13'), { owner: 'suredesigntshirts', repo: 'ccp_xstate_scratch', pullNumber: 13 });
  assert.equal(prRef('https://github.com/o/r/issues/1'), null);
  assert.equal(prRef(undefined), null);
});

test('merge-at-sha: the merge passes the verdict sha as expectedHeadSha, and the item ends done with the merge sha', async () => {
  const gh = await fakeGitHub(A);
  try {
    const root = fresh();
    const host = await toMerging(root, A, { github: gh.client });
    assert.equal(host.snapshot.value, 'done');
    assert.deepEqual(gh.state.merges, [{ sha: A, merge_method: 'merge' }]);
    assert.equal(host.snapshot.context.merge.sha, 'd'.repeat(40));
    const end = effectRows(root).find((r) => r.payload.actor === 'merge' && r.payload.phase === 'done');
    assert.deepEqual(end.payload.outcome, { ref: 'o/r#1', repo: 'o/r', number: 1, head: A, sha: 'd'.repeat(40) });
  } finally {
    await gh.close();
  }
});

test('merge-at-sha: a push after the verdict makes the merge fail, the PR stays open, and the item steps back', async () => {
  const gh = await fakeGitHub(A);
  try {
    const root = fresh();
    // The push lands between the verdict (at A) and the merge effect.
    // The approval card answers once; the replanning card it steps back to waits.
    let asked = 0;
    const ask = { start: async (e) => (asked++ ? { ref: e.id } : ((gh.state.head = B), { ref: e.id, output: { choice: 'approve', by: 'person' } })) };
    const host = await toMerging(root, A, { github: gh.client, actors: { ask } });
    assert.deepEqual(gh.state.merges, [{ sha: A, merge_method: 'merge' }]);
    assert.equal(gh.state.merged, false);
    assert.equal(host.snapshot.value, 'replanning');
    assert.match(host.snapshot.context.failure, /refused the merge of o\/r#1 at a{40}.*Head branch was modified.*head is b{40}/);
    const end = effectRows(root).filter((r) => r.payload.actor === 'merge').at(-1);
    assert.equal(end.payload.phase, 'failed');
  } finally {
    await gh.close();
  }
});

test('a merge with no PR URL or no verified sha never calls GitHub', async () => {
  let calls = 0;
  const counting = { merge: async () => { calls++; return { sha: 'x' }; }, pull: async () => { calls++; return {}; } };
  const { run } = handlers({ github: counting });
  await assert.rejects(run.start({ actor: 'merge', input: { pr: { url: 'nope' }, sha: A } }), /no PR URL/);
  await assert.rejects(run.start({ actor: 'merge', input: { pr: { url: URL_ }, sha: 'HEAD' } }), /no verified sha/);
  assert.equal(calls, 0);
});

test('effects-acked-once: a host that stopped mid-merge asks GitHub, and does not merge again', async () => {
  const gh = await fakeGitHub(A);
  try {
    const root = fresh();
    // A host with no merge handler takes the item to merging and leaves the merge pending.
    const first = await toMerging(root, A, {});
    assert.equal(first.snapshot.value, 'merging');
    const [effect] = pending(first).effects.filter((e) => e.actor === 'merge');
    // It stopped mid-effect: the start row is written and GitHub merged, but no end row was.
    persist(first, { file: first.file, kind: 'engine.effect', source: { system: 'engine', ref: effect.id }, session: 's', item: 'it-1', state: '"merging"', release: '0.2.0',
      payload: { effect: effect.id, type: 'run', phase: 'start', transition: effect.transition, actor: 'merge', outcome: null, rule: null, reason: null } });
    await gh.client.merge({ ...prRef(effect.input.pr.url), expectedHeadSha: effect.input.sha });
    const again = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
    await offer(again, [], handlers({ github: gh.client }));
    assert.equal(gh.state.merges.length, 1, 'one merge call only');
    assert.equal(again.snapshot.value, 'done');
    const ends = effectRows(root).filter((r) => r.payload.effect === effect.id).map((r) => r.payload.phase);
    assert.deepEqual(ends, ['start', 'done']);
  } finally {
    await gh.close();
  }
});

test('effects-acked-once: find() says merged at the verified head, or null when it never merged', async () => {
  const gh = await fakeGitHub(A);
  try {
    const { run } = handlers({ github: gh.client });
    const effect = { id: 'it:5.merge', actor: 'merge', input: { pr: { url: URL_ }, sha: A } };
    assert.equal(await run.find(effect), null);
    await run.start(effect);
    assert.deepEqual(await run.find(effect), { ref: 'o/r#1', repo: 'o/r', number: 1, head: A, sha: 'd'.repeat(40), output: { sha: 'd'.repeat(40) } });
    gh.state.head = B;
    await assert.rejects(run.find(effect), /merged at b{40}, not a{40}/);
  } finally {
    await gh.close();
  }
});

test('card: puts up a card keyed by the effect id and records its id and choices; the answer comes from the tap', async () => {
  const made = [];
  const hearth = { card: async (c) => { made.push(c); return { ref: 'cmsg_card1' }; }, post: async () => ({ ref: 'm' }) };
  const { run } = handlers({ hearth });
  const effect = { id: 'it:3.ask', actor: 'ask', input: { question: 'Merge?', choices: ['approve', 'reject'] } };
  assert.deepEqual(await run.start(effect), { ref: 'cmsg_card1', choices: ['approve', 'reject'] });
  assert.deepEqual(made, [{ key: 'it:3.ask', question: 'Merge?', choices: ['approve', 'reject'] }]);
  await assert.rejects(run.start({ ...effect, input: { question: 'Merge?', choices: ['one'] } }), /two choices/);
  assert.equal(await run.find(effect), undefined, 'no find on the client: the host journals unknown, never a second card');
});

test('post: posts the text keyed by the effect id and finishes with the message id as output', async () => {
  const sent = [];
  const hearth = { card: async () => ({ ref: 'c' }), post: async (p) => { sent.push(p); return { ref: 'cmsg_post1' }; }, find: async (key) => (key === 'it:2.post' ? { ref: 'cmsg_post1' } : null) };
  const { run } = handlers({ hearth });
  const effect = { id: 'it:2.post', actor: 'post', input: { text: 'Merged.' } };
  assert.deepEqual(await run.start(effect), { ref: 'cmsg_post1', output: { ref: 'cmsg_post1' } });
  assert.deepEqual(sent, [{ key: 'it:2.post', text: 'Merged.' }]);
  assert.deepEqual(await run.find(effect), { ref: 'cmsg_post1', output: { ref: 'cmsg_post1' } });
  assert.equal(await run.find({ ...effect, id: 'other' }), null);
});

test('without a thread client, cards stay pending: the run handler leaves actors it has no effect for', async () => {
  const root = fresh();
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  const actors = { brief: { start: async (e) => ({ ref: e.id, output: BRIEFS }) }, build: { start: async (e) => ({ ref: e.id, output: pr(A) }) }, verify: { start: async (e) => ({ ref: e.id, output: verdict('PASS', A) }) } };
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 's' } }], handlers({ actors }));
  assert.equal(host.snapshot.value, 'awaitingMerge');
  assert.deepEqual(pending(host).effects.map((e) => e.actor), ['ask']);
  assert.equal(effectRows(root).filter((r) => r.payload.actor === 'ask').length, 0);
});

test('timer: asks the clock for a wake at the due time keyed by the effect id; cancel drops it', async () => {
  const asked = [], dropped = [];
  const clock = { wakeAt: async (w) => { asked.push(w); return { ref: 'trigger-1' }; }, drop: async (d) => dropped.push(d) };
  const { timer, cancel } = handlers({ clock });
  const effect = { id: 'it:1.buildTimeout', type: 'timer', timer: 'xstate.after.buildTimeout', due: '2026-10-30T21:00:00.000Z' };
  assert.deepEqual(await timer.start(effect), { ref: 'trigger-1', due: effect.due });
  assert.deepEqual(asked, [{ key: effect.id, due: effect.due }]);
  await cancel.start({ id: `${effect.id}:cancel`, type: 'cancel' });
  assert.deepEqual(dropped, [{ key: effect.id }]);
  assert.deepEqual(await handlers().timer.start(effect), { ref: `due ${effect.due}`, due: effect.due });
  await assert.rejects(handlers().timer.start({ ...effect, due: null }), /no due time/);
});

test('timer: a building item journals its buildTimeout timer effect done, once', async () => {
  const root = fresh();
  const host = restore({ root, item: 'it-1', spec: workflow, session: 's', release: '0.2.0' });
  const brief = { start: async (e) => ({ ref: e.id, output: BRIEFS }) };
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 's' } }], handlers({ actors: { brief } }));
  await runEffects(host, handlers({ actors: { brief } }));
  const timers = effectRows(root).filter((r) => r.payload.type === 'timer');
  assert.deepEqual(timers.map((r) => r.payload.phase), ['start', 'done']);
});

test('no-bash: across this suite, no effect ran a shell command (child_process and $.process record zero calls)', () => {
  assert.deepEqual(shells, []);
});
