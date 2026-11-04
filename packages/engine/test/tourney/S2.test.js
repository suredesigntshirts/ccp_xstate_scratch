// Lane S round 2: the judge's new problems for lane S, fixed at no primitive cost, each shown through the real code.
// (1) A model stage named like a workflow is still its own agent, never a child item (handler order).
// (2) The verifier gets the host-made checkout commands for the PR under test, and no input shows the fields the host
//     stamps on a ref (key, gates, green, checkout); an agent that sets one is refused as reserved.
// (3) A send-back is journalled word for word with its hash (critique fix 12, grafted from lane M).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handlers } from '../../src/effects/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun, runDir, spawn, bind, stopped, handback } from '../../src/actors.js';
import { makeWorld, ISSUE, BRIEFS, builds } from './world.js';
import { part } from './contract.js';

test('S2: a stage named like a workflow is started by the stage handler, not as a child item', async () => {
  const started = [];
  const stage = { start: (effect) => { started.push(effect.id); return { ref: effect.id }; } };
  const h = handlers({ actors: { research: stage }, host: { root: '/nowhere' }, workflows: ['research'], handlersFor: () => ({}) });
  const effect = { id: 'r:1.research', actor: 'research', input: {} };
  assert.ok(h.run.handles(effect));
  assert.deepEqual(await h.run.start(effect), { ref: 'r:1.research' });
  assert.deepEqual(started, ['r:1.research']);
});

test('S2: the verify prompt carries the exact checkout commands; target shows only url and at; a stamped field set by an agent is refused', async () => {
  const w = await makeWorld();
  try {
    await w.start('c', 'quick-fix', { issue: ISSUE });
    await w.agent('c', 'brief', () => BRIEFS); await w.drive('c');
    await w.agent('c', 'build', builds(w, 1)); await w.drive('c');
    const run = loadRun(w.root, w.openRun('c', 'verify').id);
    const { url, at, key, green, checkout } = run.input.target;
    assert.equal(key, 'o/r#1'); assert.equal(green, true);
    assert.equal(checkout, `git fetch origin pull/1/head && git checkout --detach ${at}`);
    assert.equal(run.input.checkout, checkout);
    const prompt = readFileSync(join(runDir(w.root, run.run), 'brief.md'), 'utf8');
    const inputs = part(prompt, 'Inputs');
    assert.ok(inputs.includes(`  = ${JSON.stringify({ url, at })}\n`), 'target shown as { url, at } only');
    assert.ok(inputs.includes(`  = ${JSON.stringify(checkout)}`), 'checkout shown as data');
    assert.ok(!/"key"|"green"|"gates"|"checkout":/.test(inputs), 'no stamped field shown');
    const got = await w.agent('c', 'verify', ({ input, worktree }) => {
      w.checkout(worktree, input.target.at);
      return { result: 'PASS', pr: { url, at, checkout: 'x' }, issue: input.issue, lines: input.issue.expect.map((line) => ({ line, result: 'PASS', evidence: 'ran it' })) };
    }, 'ag-cv');
    assert.equal(got.refused?.rule, 'reserved');
  } finally {
    await w.close();
  }
});

test('S2: a send-back (SubagentStop and SubagentHandback) is journalled word for word with its hash', async () => {
  const w = await makeWorld();
  try {
    await w.start('s', 'quick-fix', { issue: ISSUE });
    const sha256 = (t) => createHash('sha256').update(t).digest('hex');
    const sent = () => w.rows('s').filter((r) => r.kind === 'refusal' && r.payload.rule === 'sent-back');
    const runId = w.openRun('s', 'brief').id;
    spawn({ root: w.root, prompt: `ccp-run ${runId}`, toolUseId: 'toolu_a' });
    bind({ root: w.root, agentId: 'ag-a', toolUseId: 'toolu_a' });
    const { block } = stopped({ root: w.root, agentId: 'ag-a', session: 'h' });
    assert.ok(block.includes(runId));
    assert.equal(sent().length, 1);
    assert.equal(sent()[0].payload.reason, block, 'the text the agent got, word for word');
    assert.equal(sent()[0].payload.textHash, sha256(block));
    assert.equal(sent()[0].payload.tool, 'SubagentStop');
  } finally {
    await w.close();
  }
  const w2 = await makeWorld();
  try {
    await w2.start('h', 'quick-fix', { issue: ISSUE });
    const runId = w2.openRun('h', 'brief').id;
    spawn({ root: w2.root, prompt: `ccp-run ${runId}`, toolUseId: 'toolu_b' });
    bind({ root: w2.root, agentId: 'ag-b', toolUseId: 'toolu_b' });
    const { deny } = handback({ root: w2.root, agentId: 'ag-b' });
    const row = w2.rows('h').find((r) => r.kind === 'refusal' && r.payload.rule === 'sent-back');
    assert.equal(row.payload.reason, deny);
    assert.equal(row.payload.tool, 'SubagentHandback');
  } finally {
    await w2.close();
  }
});
