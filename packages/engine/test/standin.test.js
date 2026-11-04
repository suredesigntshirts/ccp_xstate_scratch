// A stand-in's answer through the host (plan item engine-cards-standin): taken only if it is one of the ask's choices
// and a grant covers it, journalled with the grant, and followed by the host's own merge; a tap still answers too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { restore, offer, pending } from '../src/index.js';
import { handlers, relay, recordCard } from '../src/effects/index.js';
import { standinInput, repoOf } from '../src/standin.js';
import { readFile } from '../../journal/src/index.js';
import { workflow, ISSUE, BRIEFS, A, pr, verdict } from './flow.js';

const cli = new URL('../bin/host.js', import.meta.url).pathname;
const CARD = 'cmsg_01CardPostedByTheThread';
const tap = (card, index = 0, option = 'A') => readFileSync(new URL('../../../plugins/harness/test/fixtures/attention/tap-wake.txt', import.meta.url), 'utf8')
  .replace(/decision_id=[^<]*/, `decision_id=${card}`)
  .replace(/option=[^<]*/, `option=${option}`)
  .replace(/option_index=[^<]*/, `option_index=${index}`);
const GRANT = { id: 'g-away', workflow: 'quick-fix', ask: 'ask', choices: ['approve', 'reject'], repos: ['o/r'], until: '2999-01-01T00:00:00Z', granted_by: 'person' };

// A journal under <harness>/journal with grants.json beside it, and an item of quick-fix at awaitingMerge on head A.
async function toAwaitingMerge(grants = [GRANT]) {
  const harness = mkdtempSync(join(tmpdir(), 'engine-standin-'));
  const root = join(harness, 'journal');
  writeFileSync(join(harness, 'grants.json'), JSON.stringify({ grants }));
  const host = restore({ root, item: 'it-1', spec: workflow, session: 'owner', release: '0.2.0' });
  const outputs = { brief: BRIEFS, build: pr(A), verify: verdict('PASS', A) };
  const actors = Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, { start: async (e) => ({ ref: e.id, output }) }]));
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 'owner' } }],
    handlers({ hearth: relay({ root }), actors }));
  return { root, harness, host };
}
const askRun = (host) => pending(host).runs.find((r) => r.actor === 'ask');

// A GitHub that merges PR 1 of o/r at head A only.
async function fakeGitHub() {
  const merges = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.method === 'GET') return reply(200, { number: 1, merged: merges.length > 0, merge_commit_sha: merges.length ? 'd'.repeat(40) : null, head: { sha: A } });
      const { sha } = JSON.parse(body || '{}');
      merges.push(sha);
      return sha === A ? reply(200, { sha: 'd'.repeat(40), merged: true }) : reply(409, { message: 'Head branch was modified.' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { merges, api: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

// Run asynchronously: the fake GitHub answers from this process, so a blocking spawn would deadlock.
const hostCli = (root, args, { input = '', env = {} } = {}) => new Promise((ok) => {
  const child = spawn(process.execPath, [cli, ...args, '--item', 'it-1', '--workflow', 'quick-fix', '--root', root, '--release', '0.2.0'],
    { env: { ...process.env, ...env } });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.on('close', (status) => ok({ status, stdout, stderr, json: status === 0 ? JSON.parse(stdout) : null }));
  child.stdin.end(input);
});

test('repoOf reads owner/repo from a PR URL', () => {
  assert.equal(repoOf('https://github.com/o/r/pull/1'), 'o/r');
  assert.equal(repoOf('https://github.com/o/r/issues/1'), null);
  assert.equal(repoOf(undefined), null);
});

test('standinInput refuses before the card is up, an illegal choice, a missing session, and any grant that does not cover it', async () => {
  const { root, host } = await toAwaitingMerge();
  const ask = askRun(host);
  const at = '2026-10-31T04:00:00Z';
  assert.throws(() => standinInput(host, { effect: ask.id, choice: 'approve', by: 's', grants: [GRANT], at }), /card .* is not up/);
  recordCard({ host, effect: ask.id, ref: CARD });
  await offer(host, [], handlers({ hearth: relay({ root }) }));
  assert.throws(() => standinInput(host, { effect: 'it-1:0.brief', choice: 'approve', by: 's', grants: [GRANT], at }), /not an open ask run/);
  assert.throws(() => standinInput(host, { effect: ask.id, choice: 'merge-anyway', by: 's', grants: [GRANT], at }), /not one of the ask's choices/);
  assert.throws(() => standinInput(host, { effect: ask.id, choice: 'approve', by: ' ', grants: [GRANT], at }), /answering session/);
  for (const [grant, why] of [
    [{ ...GRANT, workflow: 'feature' }, /workflow feature/],
    [{ ...GRANT, ask: 'review' }, /ask review/],
    [{ ...GRANT, choices: ['reject'] }, /does not grant "approve"/],
    [{ ...GRANT, repos: ['o/other'] }, /repo o\/r not granted/],
    [{ ...GRANT, until: '2026-10-31T03:59:59Z' }, /expired/]
  ]) assert.throws(() => standinInput(host, { effect: ask.id, choice: 'approve', by: 's', grants: [grant], at }), why);
  assert.throws(() => standinInput(host, { effect: ask.id, choice: 'approve', by: 's', grants: [], at }), /no grants/);
  const input = standinInput(host, { effect: ask.id, choice: 'approve', by: 'standin-session', grants: [{ ...GRANT, repos: [] }, GRANT], at });
  assert.deepEqual(input.source, { system: 'standin', ref: `g-away ${CARD}` });
  assert.deepEqual(input.event.output, { choice: 'approve', by: 'standin-session', grant: 'g-away' });
});

test('bin/host.js answer: a refused answer exits 2 and changes nothing; a granted one is journalled with its grant and the host merges at the verdict sha', async () => {
  const { root, host } = await toAwaitingMerge();
  const ask = askRun(host);
  const gh = await fakeGitHub();
  try {
    const env = { CCP_GITHUB_API: gh.api };
    const answer = (choice, extra = []) => hostCli(root, ['answer', '--effect', ask.id, '--choice', choice, '--by', 'standin-session', ...extra], { env });
    const before = readFile(host.file).rows.length;

    const early = await answer('approve');
    assert.equal(early.status, 2);
    assert.match(early.stderr, /not up yet/);
    assert.equal((await hostCli(root, ['card', '--effect', ask.id, '--ref', CARD])).status, 0);

    const illegal = await answer('merge-anyway');
    assert.equal(illegal.status, 2);
    assert.match(illegal.stderr, /refused: "merge-anyway" is not one of the ask's choices/);
    const ungranted = await answer('approve', ['--grants', join(root, '..', 'nope.json')]);
    assert.equal(ungranted.status, 2);
    assert.match(ungranted.stderr, /refused: no grants file/);
    assert.equal(readFile(host.file).rows.filter((r) => r.kind === 'engine.transition').length,
      readFile(host.file).rows.slice(0, before).filter((r) => r.kind === 'engine.transition').length, 'no transition from a refused answer');
    assert.deepEqual(gh.merges, []);

    const got = await answer('approve');
    assert.equal(got.status, 0, got.stderr);
    const applied = got.json.results.find((r) => r.event === 'xstate.done.actor.ask');
    assert.equal(applied.outcome, 'applied');
    assert.deepEqual(applied.source, { system: 'standin', ref: `g-away ${CARD}` });
    assert.equal(got.json.state, 'done');
    assert.deepEqual(gh.merges, [A]);
    const row = readFile(host.file).rows.find((r) => r.kind === 'engine.transition' && r.payload.event.type === 'xstate.done.actor.ask');
    assert.deepEqual(row.payload.event.output, { choice: 'approve', by: 'standin-session', grant: 'g-away' });

    // The ask is answered, so the person's later tap on the same card is not applied.
    const late = await hostCli(root, ['wake'], { input: JSON.stringify({ session_id: 'owner', hook_event_name: 'UserPromptSubmit', prompt: tap(CARD) }), env });
    assert.equal(late.status, 0, late.stderr);
    assert.equal(late.json.results.filter((r) => r.outcome === 'applied').length, 0);
    assert.deepEqual(gh.merges, [A]);
  } finally {
    await gh.close();
  }
});

test('a tap first still answers the ask, and a stand-in answer after it is refused', async () => {
  const { root, host } = await toAwaitingMerge();
  const ask = askRun(host);
  const gh = await fakeGitHub();
  try {
    const env = { CCP_GITHUB_API: gh.api };
    assert.equal((await hostCli(root, ['card', '--effect', ask.id, '--ref', CARD])).status, 0);
    const tapped = await hostCli(root, ['wake'], { input: JSON.stringify({ session_id: 'owner', hook_event_name: 'UserPromptSubmit', prompt: tap(CARD) }), env });
    assert.equal(tapped.json.results.find((r) => r.event === 'xstate.done.actor.ask').source.system, 'hearth');
    assert.equal(tapped.json.state, 'done');
    const after = await hostCli(root, ['answer', '--effect', ask.id, '--choice', 'reject', '--by', 'standin-session'], { env });
    assert.equal(after.status, 2);
    assert.match(after.stderr, /refused/);
    assert.deepEqual(gh.merges, [A]);
  } finally {
    await gh.close();
  }
});
