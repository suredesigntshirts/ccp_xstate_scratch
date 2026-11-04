// Shared by the contract tests P2-P6 (tournament 2026-11-04-stage-contract, lane S): the prompt of every model-stage
// run in quick-fix, research and feature, read from the run folder the real run handler wrote (brief.md is the
// Agent prompt), and the three workflows parsed straight from workflows/*.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun, runDir } from '../../src/actors.js';
import { makeWorld, ISSUE, builds } from './world.js';

export const WORKFLOWS = Object.fromEntries(['quick-fix', 'research', 'feature'].map((n) =>
  [n, JSON.parse(readFileSync(new URL(`../../../../workflows/${n}.json`, import.meta.url), 'utf8'))]));

export const PAGE = 'https://example.org/p';
export const BRIEFS = { builder: 'MARK-B do x', verifier: 'MARK-V check y' };
export const PLAN = { questions: ['a', 'b', 'c'], researcher: 'MARK-R research it', writer: 'MARK-W write it', verifier: 'MARK-RV verify it' };

/** The part of a prompt under heading `## name`, up to the next heading. */
export const part = (prompt, name) => {
  const m = prompt.match(new RegExp(`(?:^|\\n)## ${name}\\n([\\s\\S]*?)(?=\\n\\n## |$)`));
  return m ? m[1] : null;
};

/** { key: { prompt, run, workflow } } for qf.brief, qf.build, qf.verify, rs.brief, rs.researcher, rs.writer, rs.verify, ft.brief. */
export async function promptsOf() {
  const w = await makeWorld({ pages: { [PAGE]: 'a quote here' } });
  const got = {};
  const grab = (key, workflow, item, actor) => {
    const run = loadRun(w.root, w.openRun(item, actor).id);
    got[key] = { prompt: readFileSync(join(runDir(w.root, run.run), 'brief.md'), 'utf8'), run, workflow, root: w.root, item };
  };
  try {
    await w.start('q', 'quick-fix', { issue: ISSUE });
    grab('qf.brief', 'quick-fix', 'q', 'brief');
    await w.agent('q', 'brief', () => BRIEFS); await w.drive('q');
    grab('qf.build', 'quick-fix', 'q', 'build');
    await w.agent('q', 'build', builds(w, 1)); await w.drive('q');
    grab('qf.verify', 'quick-fix', 'q', 'verify');
    await w.start('r', 'research', { issue: ISSUE });
    grab('rs.brief', 'research', 'r', 'brief');
    await w.agent('r', 'brief', () => PLAN); await w.drive('r');
    grab('rs.researcher', 'research', 'r', 'q1');
    for (const q of ['q1', 'q2', 'q3']) await w.agent('r', q, () => ({ text: 't', sources: [{ url: PAGE, at: 'a quote' }] }));
    await w.drive('r');
    grab('rs.writer', 'research', 'r', 'write');
    await w.agent('r', 'write', () => ({ text: 't', sources: [{ url: PAGE, at: 'a quote' }] })); await w.drive('r');
    grab('rs.verify', 'research', 'r', 'verify');
    await w.start('f', 'feature', { issue: ISSUE, branch: 'feature/x' });
    grab('ft.brief', 'feature', 'f', 'brief');
  } finally {
    await w.close();
  }
  return got;
}
