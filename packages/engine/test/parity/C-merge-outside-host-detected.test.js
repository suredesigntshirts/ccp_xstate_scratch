// C-merge-outside-host-detected (plan/cases/work-item.md): a PR merged on GitHub by any path other than the host's
// merge effect is listed as unverified by the health check, whether or not the PR is bound to an item. The host merges
// o/r#1 through its merge effect; #2, bound to another item waiting on its card, and #3, bound to none, are merged on
// GitHub some other way. The check is the journal's (packages/journal/bin/journal-check.js), with GitHub's closed-PR
// answer saved to a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { A, B, BRIEFS, MERGE_SHA, agents, cardOf, fakeGitHub, fresh, inputsOfWakeFor, offer, open, openRun, start, tapWake, toAwaitingMerge, verdict, world } from './world.js';

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
const closed = (number, mergedAt, sha) => ({ number, title: `PR ${number}`, merged_at: mergedAt, merge_commit_sha: sha, head: { sha: A }, html_url: `https://github.com/o/r/pull/${number}` });

test('C-merge-outside-host-detected: merges the host\'s merge effect didn\'t make are listed, bound to an item or not, and --host fails on them', async () => {
  const gh = await fakeGitHub({ 1: { head: A } });
  try {
    const root = fresh();
    // it-1: merged by the host, on the person's tap.
    const { host } = await toAwaitingMerge({ root, head: A, gh });
    await offer(host, inputsOfWakeFor(host, tapWake(cardOf(host, openRun(host, 'ask')))), world({ gh }));
    assert.equal(host.snapshot.value, 'done');
    // it-2: bound to #2 and waiting on its card when #2 is merged on GitHub by hand.
    const two = open(root, { item: 'it-2' });
    const pr2 = { pr: { branch: 'build/y', headSha: B, url: 'https://github.com/o/r/pull/2' } };
    await offer(two, [{ ...start(), event: { type: 'xstate.init', input: { issue: { url: 'https://github.com/o/r/issues/8', expect: ['x'] } } } }],
      world({ actors: agents({ brief: BRIEFS, build: pr2, verify: verdict('PASS', B) }).byActor }));
    assert.equal(two.snapshot.value, 'awaitingMerge');

    const later = new Date(Date.now() + 60000).toISOString();
    const prs = join(root, 'closed-prs.json');
    writeFileSync(prs, JSON.stringify([closed(1, later, MERGE_SHA), closed(2, later, 'e'.repeat(40)), closed(3, later, 'f'.repeat(40)), closed(4, null, null)]));

    const out = await check(['--journal', root, '--repo', 'o/r', '--prs', prs, '--host', '--json']);
    assert.equal(out.status, 1, out.stderr);
    const result = JSON.parse(out.stdout);
    assert.deepEqual(result.merges.outsideHost.map((p) => p.number).sort(), [2, 3]);
    assert.equal(result.merges.hostRows, 1, 'the host\'s own merge of #1 is its merge effect row');
    assert.equal(result.ok, false);

    // Listed even without --host, where they are reported but don't fail the check on their own.
    const listed = await check(['--journal', root, '--repo', 'o/r', '--prs', prs]);
    assert.match(listed.stdout, /o\/r#2/);
    assert.match(listed.stdout, /o\/r#3/);
  } finally {
    await gh.close();
  }
});
