// World step for Expect merge-at-sha. Usage: node merge-at-sha.mjs <stale|control> <pr number> <branch> <worktree> <out dir>
// Drives a real quick-fix item with the real host and the real effects/github.js client against the scratch repo.
// In stale mode the ask stub (awaitingMerge) pushes commit B to the PR between the PASS verdict (at A) and the merge effect.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restore, offer, itemFile, loadWorkflow } from '../../../packages/engine/src/index.js';
import { handlers, github } from '../../../packages/engine/src/effects/index.js';
import { readFile } from '../../../packages/journal/src/index.js';

const [mode, number, branch, wt, out] = process.argv.slice(2);
const owner = 'suredesigntshirts', repo = 'ccp_xstate_scratch', pullNumber = Number(number);
const gh = github();
const A = (await gh.pull({ owner, repo, pullNumber })).head.sha;
const calls = [];
const spy = { pull: (a) => gh.pull(a), merge: async (a) => {
  const call = { args: { ...a }, at: new Date().toISOString() };
  calls.push(call);
  try { const r = await gh.merge(a); call.result = { ok: true, sha: r.sha }; return r; }
  catch (e) { call.result = { ok: false, status: e.status, message: e.github }; throw e; }
} };
let B = null;
const root = mkdtempSync(join(tmpdir(), 'ee-world-'));
const item = `scratch-${mode}-${pullNumber}`;
const host = restore({ root, item, spec: loadWorkflow('quick-fix'), session: 'verifier-engine-effects', release: '0.2.0' });
const actors = {
  brief: { start: async () => ({ output: { builder: 'b.md', verifier: 'v.md' } }) },
  build: { start: async () => ({ output: { pr: { branch, headSha: A, url: `https://github.com/${owner}/${repo}/pull/${pullNumber}` } } }) },
  verify: { start: async () => ({ output: { result: 'PASS', sha: A, report: 'stub verifier: PASS at A' } }) },
  ask: { start: async (e) => {
    if (!/Merge this PR/.test(e.input?.question?.value ?? e.input?.question ?? '')) return { ref: 'card-for-person' }; // the replanning card waits for a person
    if (mode === 'stale' && !B) {
      execFileSync('sh', ['-c', `echo "B ${Date.now()}" >> verify-ee-${mode}.txt && git add -A && git commit -q -m "engine-effects verify: commit B after the verdict" && git push -q origin HEAD:${branch}`], { cwd: wt });
      B = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt }).toString().trim();
      for (let i = 0; i < 30; i++) { if ((await gh.pull({ owner, repo, pullNumber })).head.sha === B) break; await new Promise((r) => setTimeout(r, 1000)); }
    }
    return { output: { choice: 'approve', by: 'stub' } };
  } }
};
const h = handlers({ github: spy, actors });
await offer(host, [{ event: { type: 'xstate.init', input: { issue: { url: 'https://github.com/o/r/issues/1', expect: ['x'] } } }, source: { system: 'claude-code', ref: 'verifier-engine-effects' } }], h);
const after = await gh.pull({ owner, repo, pullNumber });
const rows = readFile(itemFile(root, item)).rows;
cpSync(itemFile(root, item), join(out, `merge-${mode}.journal.jsonl`));
const evidence = {
  mode, pr: `${owner}/${repo}#${pullNumber}`, commitA: A, commitB: B, finalState: host.snapshot.value,
  mergeCalls: calls,
  prAfter: { state: after.state, merged: after.merged, head: after.head.sha },
  mergeEffectRows: rows.filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'merge').map((r) => ({ phase: r.payload.phase, reason: r.payload.reason, outcome: r.payload.outcome, input: r.payload.effect && undefined }))
};
writeFileSync(join(out, `merge-${mode}.json`), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
