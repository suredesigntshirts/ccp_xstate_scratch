// Verifier tests for plan item engine-cards-standin, written by the verifier session (not the builder), from case
// C-stand-in-picks-legal-event: against `bin/host.js answer` on items recorded here. Offline (a fake GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { restore, offer, pending } from '../../packages/engine/src/index.js';
import { handlers, relay } from '../../packages/engine/src/effects/index.js';
import { readFile } from '../../packages/journal/src/index.js';
import { workflow, ISSUE, BRIEFS, A, pr, verdict } from '../../packages/engine/test/flow.js';

const cli = new URL('../../packages/engine/bin/host.js', import.meta.url).pathname;
const CARD = 'cmsg_verifierCard';
const PAST = new Date(Date.now() - 3600e3).toISOString();
const G = { id: 'v-grant', workflow: 'quick-fix', ask: 'ask', choices: ['approve', 'reject'], repos: ['o/r'], until: '2999-01-01T00:00:00Z' };

async function record(grants) {
  const harness = mkdtempSync(join(tmpdir(), 'verify-standin-'));
  const root = join(harness, 'journal');
  if (grants !== undefined) writeFileSync(join(harness, 'grants.json'), JSON.stringify({ grants }));
  const host = restore({ root, item: 'it-1', spec: workflow, session: 'owner', release: '0.2.0' });
  const outputs = { brief: BRIEFS, build: pr(A), verify: verdict('PASS', A) };
  const actors = Object.fromEntries(Object.entries(outputs).map(([n, output]) => [n, { start: async (e) => ({ ref: e.id, output }) }]));
  await offer(host, [{ event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 'owner' } }],
    handlers({ hearth: relay({ root }), actors }));
  const ask = pending(host).runs.find((r) => r.actor === 'ask');
  return { root, harness, host, ask };
}
async function fakeGitHub() {
  const merges = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.method === 'GET') return reply(200, { number: 1, merged: merges.length > 0, merge_commit_sha: merges.length ? 'd'.repeat(40) : null, head: { sha: A } });
      const { sha } = JSON.parse(body || '{}');
      merges.push(sha);
      return sha === A ? reply(200, { sha: 'd'.repeat(40), merged: true }) : reply(409, { message: 'Head branch was modified.' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { merges, api: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}
const run = (root, args, env = {}) => new Promise((ok) => {
  const c = spawn(process.execPath, [cli, ...args, '--item', 'it-1', '--workflow', 'quick-fix', '--root', root, '--release', '0.2.0'], { env: { ...process.env, ...env } });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => (stdout += d));
  c.stderr.on('data', (d) => (stderr += d));
  c.on('close', (status) => ok({ status, stdout, stderr, json: status === 0 ? JSON.parse(stdout) : null }));
  c.stdin.end('');
});
const rows = (host) => readFile(host.file).rows;

// legal-only
test('legal-only: every refusal exits 2, prints its reason, and adds no transition and no merge', async () => {
  const cases = [
    ['an illegal choice', [G], ['--choice', 'merge-anyway'], /not one of the ask's choices/],
    ['a missing grants file', undefined, ['--choice', 'approve'], /no grants file/],
    ['an expired grant', [{ ...G, until: PAST }], ['--choice', 'approve'], /expired/],
    ['a grant for another repo', [{ ...G, repos: ['o/other'] }], ['--choice', 'approve'], /repo o\/r not granted/],
    ['a grant for another ask', [{ ...G, ask: 'review' }], ['--choice', 'approve'], /ask review/],
    ['a grant for another workflow', [{ ...G, workflow: 'feature' }], ['--choice', 'approve'], /workflow feature/],
    ['a grant that does not list the choice', [{ ...G, choices: ['reject'] }], ['--choice', 'approve'], /does not grant "approve"/],
    ['an empty grant list', [], ['--choice', 'approve'], /no grant covers/],
  ];
  for (const [name, grants, args, why] of cases) {
    const t = await record(grants);
    const gh = await fakeGitHub();
    try {
      assert.equal((await run(t.root, ['card', '--effect', t.ask.id, '--ref', CARD])).status, 0);
      const before = readFileSync(t.host.file, 'utf8');
      const r = await run(t.root, ['answer', '--effect', t.ask.id, '--by', 'standin', ...args], { CCP_GITHUB_API: gh.api });
      assert.equal(r.status, 2, `${name}: ${r.stdout}`);
      assert.match(r.stderr, /refused/, name);
      assert.match(r.stderr, why, name);
      const after = readFileSync(t.host.file, 'utf8');
      assert.equal(after.split('\n').filter((l) => /engine\.transition/.test(l)).length, before.split('\n').filter((l) => /engine\.transition/.test(l)).length, `${name}: no transition`);
      assert.equal(gh.merges.length, 0, `${name}: no merge`);
      const shown = await run(t.root, ['show']);
      assert.notEqual(shown.json.state, 'done', name);
    } finally { await gh.close(); rmSync(t.harness, { recursive: true, force: true }); }
  }
});
test('legal-only: a wrong effect id, no --by and a card not yet up are refused', async () => {
  const t = await record([G]);
  try {
    const noCard = await run(t.root, ['answer', '--effect', t.ask.id, '--choice', 'approve', '--by', 's']);
    assert.equal(noCard.status, 2); assert.match(noCard.stderr, /not up yet/);
    await run(t.root, ['card', '--effect', t.ask.id, '--ref', CARD]);
    const wrong = await run(t.root, ['answer', '--effect', 'it-1:0.brief', '--choice', 'approve', '--by', 's']);
    assert.equal(wrong.status, 2); assert.match(wrong.stderr, /not an open ask run/);
    const noBy = await run(t.root, ['answer', '--effect', t.ask.id, '--choice', 'approve']);
    assert.equal(noBy.status, 2); assert.match(noBy.stderr, /answering session/);
  } finally { rmSync(t.harness, { recursive: true, force: true }); }
});

// grant-source
test('grant-source: a legal answer is journalled with source standin, the grant id in ref, and the session in output; the host merges at the verdict sha', async () => {
  const other = { ...G, id: 'v-other', repos: ['x/y'] };
  const t = await record([other, G]);
  const gh = await fakeGitHub();
  try {
    await run(t.root, ['card', '--effect', t.ask.id, '--ref', CARD]);
    const r = await run(t.root, ['answer', '--effect', t.ask.id, '--choice', 'approve', '--by', 'verifier-session-xyz'], { CCP_GITHUB_API: gh.api });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.state, 'done');
    assert.deepEqual(gh.merges, [A]);
    const row = rows(t.host).find((x) => x.kind === 'engine.transition' && x.payload.event.type === 'xstate.done.actor.ask');
    assert.equal(row.payload.outcome, 'applied');
    assert.equal(row.source.system, 'standin');
    assert.equal(row.source.ref, `v-grant ${CARD}`);
    assert.deepEqual(row.payload.event.output, { choice: 'approve', by: 'verifier-session-xyz', grant: 'v-grant' });
    // a second answer finds no open ask
    const again = await run(t.root, ['answer', '--effect', t.ask.id, '--choice', 'reject', '--by', 'standin'], { CCP_GITHUB_API: gh.api });
    assert.equal(again.status, 2);
    assert.deepEqual(gh.merges, [A]);
  } finally { await gh.close(); rmSync(t.harness, { recursive: true, force: true }); }
});
test('grant-source: reject is also journalled with its grant and does not merge', async () => {
  const t = await record([G]);
  const gh = await fakeGitHub();
  try {
    await run(t.root, ['card', '--effect', t.ask.id, '--ref', CARD]);
    const r = await run(t.root, ['answer', '--effect', t.ask.id, '--choice', 'reject', '--by', 's2'], { CCP_GITHUB_API: gh.api });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(gh.merges, []);
    const row = rows(t.host).find((x) => x.kind === 'engine.transition' && x.payload.event.type === 'xstate.done.actor.ask');
    assert.equal(row.source.system, 'standin');
    assert.equal(row.payload.event.output.grant, 'v-grant');
  } finally { await gh.close(); rmSync(t.harness, { recursive: true, force: true }); }
});
