// Runs pr-gate.mjs against a throwaway git repo, the way verdict.yml runs it against a PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const gate = join(dirname(fileURLToPath(import.meta.url)), '..', 'pr-gate.mjs');
const itemFile = (expect, status = 'ready') =>
  `\`\`\`json\n${JSON.stringify({ id: 'x', status, expect })}\n\`\`\`\n\n## Verifier brief\n\nRun it.\n`;
const expect = [{ id: 'a', proof: 'world' }];
const verdict = (sha) => JSON.stringify({
  item: 'x', verified_sha: sha, results: [{ id: 'a', status: 'MET', command: 'gh pr checks', excerpt: 'red' }],
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  const write = (path, text) => { mkdirSync(join(dir, dirname(path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  const commit = (files, session) => {
    for (const [p, t] of Object.entries(files)) write(p, t);
    git('add', '-A');
    git('commit', '-q', '-m', session ? `change\n\nClaude-Session: ${session}` : 'change');
    return git('rev-parse', 'HEAD');
  };
  const base = commit({ 'plan/items/x.md': itemFile(expect) });
  const run = (which, env = {}) => spawnSync('node', [gate, which], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, BASE_SHA: base, HEAD_SHA: git('rev-parse', 'HEAD'), PR_BRANCH: 'build/x', PR_BODY: '', PR_LABELS: '[]', ...env },
  });
  return { commit, run };
}

test('verdict gate: none, then from the builder session, then from a separate session', () => {
  const r = repo();
  const built = r.commit({ 'packages/a/index.js': 'export const a = 1;\n' }, 'builder');
  let out = r.run('verdict');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /no verify\/x\/verdict.json/);

  r.commit({ 'verify/x/verdict.json': verdict(built) }, 'builder');
  out = r.run('verdict');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /same Claude-Session as builder commit/);

  r.commit({ 'verify/x/verdict.json': verdict(built) + '\n' }, 'verifier');
  out = r.run('verdict');
  assert.equal(out.status, 0, out.stderr);

  r.commit({ 'packages/a/index.js': 'export const a = 2;\n' }, 'builder');
  out = r.run('verdict');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /after the verified sha/);
});

test('verdict gate: a PR that names no item passes only if it touches plan/ alone', () => {
  const r = repo();
  r.commit({ 'plan/decisions/d.md': 'chosen\n' });
  assert.equal(r.run('verdict', { PR_BRANCH: 'docs/d' }).status, 0);
  r.commit({ 'docs/d.md': 'notes\n' });
  const out = r.run('verdict', { PR_BRANCH: 'docs/d' });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /names no item/);
});

test('freeze gate: softening an Expect line of the named item is red unless a plan-only replan', () => {
  const r = repo();
  r.commit({ 'plan/items/x.md': itemFile([{ id: 'a', proof: 'builder' }], 'doing') });
  let out = r.run('freeze');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /changes the contract of x/);
  assert.equal(r.run('freeze', { PR_LABELS: '["replan"]' }).status, 0);
  r.commit({ 'packages/a/index.js': 'export const a = 1;\n' });
  assert.equal(r.run('freeze', { PR_LABELS: '["replan"]' }).status, 1);
});

test('freeze gate: a status-only change passes', () => {
  const r = repo();
  r.commit({ 'plan/items/x.md': itemFile(expect, 'done') });
  assert.equal(r.run('freeze').status, 0);
});

test('stubs gate: one TODO under packages/ is red', () => {
  const r = repo();
  r.commit({ 'packages/a/index.js': 'export const a = 1;\n' });
  assert.equal(r.run('stubs').status, 0);
  r.commit({ 'packages/a/index.js': 'export const a = 1; // TODO\n' });
  const out = r.run('stubs');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /packages\/a\/index.js:1 has TODO/);
});
