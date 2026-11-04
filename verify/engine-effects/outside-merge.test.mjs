// Expect outside-merge (verifier-written, from case C-merge-outside-host-detected): a PR merged on GitHub by any path
// other than the host's merge effect is listed by the journal check, whether or not it is bound to an item; a host
// merge effect row explains its own merge. Offline: GitHub's real closed-PR responses are saved in evidence/closed-prs.json
// (scratch PRs 14 closed unmerged, 15 merged by the host merge effect, 16 merged with the GitHub MCP tool).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { append } from '../../packages/journal/src/index.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const BIN = here('../../packages/journal/bin/journal-check.js');
const REPO = 'suredesigntshirts/ccp_xstate_scratch';
const PRS = here('./evidence/closed-prs.json');
const HOST_JOURNAL = here('./evidence/merge-control.journal.jsonl'); // a real host run that merged PR 15

const check = (journal, prs = PRS, extra = []) => {
  const env = { ...process.env }; delete env.HTTPS_PROXY; delete env.https_proxy;
  const r = spawnSync(process.execPath, [BIN, '--journal', journal, '--repo', REPO, '--prs', prs, '--since', '2026-10-30T00:00:00Z', '--json', ...extra], { encoding: 'utf8', env });
  return { status: r.status, out: JSON.parse(r.stdout), stderr: r.stderr };
};
const numbers = (list) => list.map((p) => p.number).sort();
const dir = () => mkdtempSync(join(tmpdir(), 'ee-outside-'));
const rowBase = { source: { system: 'claude-code', ref: 'verifier' }, session: 'verifier', release: '0.2.0' };

test('the saved evidence is what GitHub said: 15 and 16 merged, 14 closed unmerged', () => {
  const prs = JSON.parse(readFileSync(PRS, 'utf8'))[REPO];
  assert.deepEqual(prs.map((p) => [p.number, Boolean(p.merged_at)]).sort(), [[14, false], [15, true], [16, true]]);
});

test('unbound outside merge: PR 16 (merged via the MCP tool) is listed as outside the host and as unexplained; the host-merged PR 15 is not', () => {
  const { status, out } = check(HOST_JOURNAL);
  assert.deepEqual(numbers(out.merges.outsideHost), [16]);
  assert.deepEqual(numbers(out.merges.unexplained), [16]);
  assert.equal(out.merges.hostRows, 1);
  assert.equal(out.merges.merges, 2);
  assert.equal(status, 1, 'the check exits 1 when it lists something');
});

test('a merge effect row explains its merge, and a closed-unmerged PR is never listed', () => {
  const { out } = check(HOST_JOURNAL);
  for (const list of [out.merges.outsideHost, out.merges.unexplained]) assert.ok(!numbers(list).includes(15) && !numbers(list).includes(14));
});

test('bound outside merge: a pr.merge row naming an item explains it as journalled, but it is still listed as not made by the host', () => {
  const d = dir(); const file = join(d, 'j.jsonl');
  copyFileSync(HOST_JOURNAL, file);
  append(file, { ...rowBase, kind: 'pr.merge', item: 'scratch-item-16', state: 'merging', payload: { repo: REPO, number: 16, sha: 'ed8f2d7741d69cc9917c7bed8b2317bed2796af4' } });
  const { status, out } = check(file);
  assert.deepEqual(numbers(out.merges.outsideHost), [16], 'still outside the host');
  assert.deepEqual(numbers(out.merges.unexplained), [], 'the bound pr.merge row explains the missing journal row');
  assert.equal(status, 0, 'without --host a journalled merge is not a failure');
  assert.equal(check(file, PRS, ['--host']).status, 1, '--host fails on any merge the host did not make');
});

test('only a merge effect that ended done explains a merge: a failed merge effect row does not', () => {
  const d = dir(); const file = join(d, 'j.jsonl');
  const prs = JSON.parse(readFileSync(PRS, 'utf8'));
  prs[REPO].push({ number: 17, title: 'x', merged_at: '2026-10-30T20:30:00Z', head: { sha: 'a'.repeat(40) }, merge_commit_sha: 'c'.repeat(40) });
  const prsFile = join(d, 'prs.json'); writeFileSync(prsFile, JSON.stringify(prs));
  const effect = (phase, extra = {}) => ({ ...rowBase, kind: 'engine.effect', item: 'scratch-item-17', state: 'merging', payload: { effect: 'scratch-item-17:3.merge', type: 'run', actor: 'merge', phase, ...extra } });
  append(file, effect('start'));
  append(file, effect('failed', { reason: 'GitHub refused the merge' }));
  let out = check(file, prsFile).out;
  assert.ok(numbers(out.merges.outsideHost).includes(17), 'a failed merge effect did not make the merge, so PR 17 is listed');
  append(file, effect('done', { outcome: { repo: REPO, number: 17, sha: 'c'.repeat(40) } }));
  out = check(file, prsFile).out;
  assert.ok(!numbers(out.merges.outsideHost).includes(17), 'a done merge effect row explains it');
});
