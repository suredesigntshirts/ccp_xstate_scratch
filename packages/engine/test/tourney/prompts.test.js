// The helper agents' prompts (design C, section 4.2): the brief is the prompt exactly, and contextOf(run) adds lines
// that appear only when their input key is present. This file records what each quick-fix agent is actually told,
// line by line, including what the design's wording leaves out (asserted as found, not as desired).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemWorld, offer, startEvent, ISSUE, BRIEFS, agentOf, deliver, builderReturns } from './world.js';
import { runDir } from '../../src/actors.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');

test('prompts: brief, build and verify are told exactly the lines their inputs call for', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    const brief = agentOf(w, 'brief');
    const bl = brief.context.split('\n');
    assert.equal(bl[0], `ccp-harness run ${brief.run.run} (item it-1, actor brief).`);
    assert.equal(bl.length, 3, 'run line, return line, input line');
    assert.match(bl[1], /^When you are done, call the harness return tool \(its name ends in harness__return\)/);
    assert.ok(!brief.context.includes(brief.run.worktree), 'FINDING: a run with no lane is never told where its worktree is');
    assert.ok(!/ToolSearch/.test(brief.context), 'FINDING: the baseline hint to load a deferred return tool with ToolSearch is gone');
    await brief.ret(BRIEFS);
    await deliver(w);

    const b = await builderReturns(w);
    const build = b.agent;
    const L = build.context.split('\n');
    assert.equal(L[1], `Your worktree is ${build.run.worktree}, on branch ccp/it-1/1. Commit and push only to ccp/it-1/1, and open or update exactly one pull request from ccp/it-1/1 into main. When you return, the host reads that pull request from GitHub: its head, base, branch and changed files are what count, not what you report.`);
    assert.ok(!/"attested"/.test(L[2].split(' (with $ref')[0].replace(/Don't include an "attested" field/, '')), 'the schema shown has attested taken out');
    assert.match(L[2], /\(with \$ref into .*"attested"/, 'FINDING: the $ref defs still show the attested schema');
    assert.ok(L.at(-1).startsWith('Your input: '));
    const shown = JSON.parse(L.at(-1).slice('Your input: '.length));
    assert.equal(shown.lane, undefined, 'lane is described, not shown');
    assert.equal(shown.brief, undefined);
    assert.equal(readFileSync(join(runDir(w.root, build.run.run), 'brief.md'), 'utf8'), BRIEFS.builder, 'the prompt is the brief exactly');
    assert.equal(build.run.briefHash, sha256(BRIEFS.builder));
    await deliver(w);

    const verify = agentOf(w, 'verify');
    const V = verify.context.split('\n');
    assert.equal(V[1], `Your worktree is checked out at ${b.head}, the commit you are judging. Do not check out, pull, commit or reset anything. When you return, the host reads your worktree's HEAD, and your verdict counts only for that commit.`);
    assert.match(V[2], /^Grade against the expect lines in your input exactly as given\./);
    assert.deepEqual(JSON.parse(V.at(-1).slice('Your input: '.length)), { expect: ISSUE.expect }, 'the verifier gets no builder report, verdict or failure');
    assert.ok(!verify.context.includes(verify.run.worktree), 'FINDING: the verifier is not told its worktree path');
  } finally {
    await w.close();
  }
});
