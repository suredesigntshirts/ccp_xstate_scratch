// Q7 merge outside the host: the PR is merged on GitHub by someone else; the item must not end as verified-done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { A, agents, fakeGitHub, fresh, loadWorkflow, offer, open, platform, prOf, start, statesOf, suite, tap, world } from './world-b.js';

const spec = loadWorkflow('quick-fix');
const ISSUE = { url: 'https://github.com/o/r/issues/7', expect: ['math.js exports multiply'] };
const CHECK = new URL('../../../journal/bin/journal-check.js', import.meta.url).pathname;
const check = (args) => new Promise((ok) => {
  const env = { ...process.env };
  delete env.HTTPS_PROXY;
  const child = spawn(process.execPath, [CHECK, ...args], { env });
  let stdout = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.on('close', (status) => ok({ status, stdout }));
});

test('Q7: a PR merged on GitHub by someone else makes the host merge fail; the item replans and ends dropped, not done', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const plat = platform();
    const root = fresh('q7');
    const host = open(root, spec);
    const a = agents({ brief: [{ builder: 'b', verifier: 'v' }], build: [{ pr: prOf(1, A) }], verify: [{ result: 'PASS', sha: A, ciChanged: false, report: 'ok' }] });
    const fx = world({ gh, plat, actors: a.byActor });
    await offer(host, [start({ issue: ISSUE })], fx);
    await offer(host, suite(host, A), fx);
    assert.equal(host.snapshot.value, 'awaitingMerge');

    gh.state[1].merged = true; // someone merges #1 on GitHub
    gh.state[1].mergeSha = 'f'.repeat(40);
    await offer(host, tap(host, 0), fx); // the person approves
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(host.snapshot.context.merge, null);
    assert.equal(host.snapshot.context.failure.kind, 'merge');
    await offer(host, tap(host, 1), fx); // "drop"
    assert.equal(host.snapshot.value, 'dropped');
    assert.ok(!statesOf(root).includes('done'), 'never verified-done');

    const prs = join(root, 'closed-prs.json');
    const later = new Date(Date.now() + 60000).toISOString();
    writeFileSync(prs, JSON.stringify([{ number: 1, title: 'PR 1', merged_at: later, merge_commit_sha: 'f'.repeat(40), head: { sha: A }, html_url: prOf(1, A).url }]));
    const out = await check(['--journal', root, '--repo', 'o/r', '--prs', prs, '--host', '--json']);
    const result = JSON.parse(out.stdout);
    assert.deepEqual(result.merges.outsideHost.map((p) => p.number), [1], 'the journal check lists #1 as merged outside the host');
    assert.equal(out.status, 1);
  } finally {
    await gh.close();
  }
});
