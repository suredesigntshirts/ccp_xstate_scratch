// Q7 Merge outside the host: the PR is merged on GitHub by someone else; the item must not end as verified-done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { A, BRIEFS, ISSUE, world, fakeGitHub, attested, returned, suiteWake, mergedWake, inputsOfWakeFor, tap, prOut, verdictOut } from './world.js';

const CHECK = new URL('../../../journal/bin/journal-check.js', import.meta.url).pathname;
const check = (args) => new Promise((ok) => {
  const env = { ...process.env };
  delete env.HTTPS_PROXY;
  const child = spawn(process.execPath, [CHECK, ...args], { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));
  child.on('close', (status) => ok({ status, stdout, stderr }));
});

async function toAwaitingMerge(gh) {
  const w = world({ gh });
  let { host } = await w.startItem('it-1', { issue: ISSUE });
  ({ host } = await w.send('it-1', [returned(host, 'briefs', BRIEFS)]));
  ({ host } = await w.send('it-1', [(await attested(host, 'pr', prOut(1, A), { gh, worktreeHead: A })).input]));
  ({ host } = await w.send('it-1', [(await attested(host, 'verify', verdictOut('PASS', 1, A), { gh, worktreeHead: A })).input]));
  ({ host } = await w.send('it-1', inputsOfWakeFor(host, suiteWake(A))));
  assert.equal(host.snapshot.value, 'awaitingMerge');
  return { w, host };
}

test('Q7 merged outside with the closed wake: the item replans, records no merge, and is not done', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    let { w, host } = await toAwaitingMerge(gh);
    gh.state[1].merged = true;
    let results;
    ({ host, results } = await w.send('it-1', inputsOfWakeFor(host, mergedWake(1))));
    assert.equal(results[0].outcome, 'applied');
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(host.snapshot.context.facts.merge, undefined);
    assert.notEqual(host.snapshot.status, 'done');
    assert.equal(gh.merges.length, 0);
  } finally {
    await gh.close();
  }
});

test('Q7 merged outside with the wake missed: the tap\'s merge is refused by GitHub, the item replans, and journal-check lists #1 as merged outside the host', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    let { w, host } = await toAwaitingMerge(gh);
    gh.state[1].merged = true;
    gh.state[1].mergeSha = 'f'.repeat(40);
    ({ host } = await w.send('it-1', tap(host, 'approval', 0)));
    assert.equal(host.snapshot.value, 'replanning');
    assert.equal(host.snapshot.context.facts.merge.v, undefined, 'no merge output recorded');
    assert.ok(host.snapshot.context.facts.merge.err);
    assert.notEqual(host.snapshot.status, 'done');

    const later = new Date(Date.now() + 60000).toISOString();
    const prs = join(w.root, 'closed-prs.json');
    writeFileSync(prs, JSON.stringify([{ number: 1, title: 'PR 1', merged_at: later, merge_commit_sha: 'f'.repeat(40), head: { sha: A }, html_url: 'https://github.com/o/r/pull/1' }]));
    const out = await check(['--journal', w.root, '--repo', 'o/r', '--prs', prs, '--host', '--json']);
    const result = JSON.parse(out.stdout);
    assert.deepEqual(result.merges.outsideHost.map((p) => p.number), [1]);
    assert.equal(result.ok, false);
  } finally {
    await gh.close();
  }
});
