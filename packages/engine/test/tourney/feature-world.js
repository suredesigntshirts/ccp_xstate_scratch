// Tourney lane E: helpers for the feature scenarios. Children are real child items started by the parent's start
// effect; the test drives each child through its own host as the platform would, and hands their ends to the parent
// through childEvents (the host's watcher of its children's journals).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ISSUE, BRIEFS, prUrl, restore, offer, loadWorkflow, makeEffects, hostFor, agentReturns, buildBranch, wake, childEvents, transitions, RELEASE, openRun, start } from './world.js';

export const QF = loadWorkflow('quick-fix');
export const FEATURE = loadWorkflow('feature');
export const SPECS = { 'quick-fix': QF };
export const slice = (n, line) => ({ issue: { url: `${ISSUE.url}#slice-${n}`, expect: [line] } });

export function feature({ root, repo, gh, plat, session = 'owner' }) {
  const childHandlers = (child) => makeEffects(child, { repo, gh, plat });
  return hostFor({ root, item: 'feat-1', spec: FEATURE, session, repo, gh, plat, specs: SPECS, childHandlers });
}
export const startFeature = (parent, effects) => offer(parent, [start({ issue: ISSUE, branch: 'feature/feat-1' })], effects);

/** The child item the parent's open start run started (its last). */
export function currentChild(parent, { repo, gh, plat }) {
  const run = openRun(parent, 'start');
  const id = parent.effects.get(run.id).outcome.children.at(-1);
  const host = restore({ root: parent.root, item: id, spec: QF, session: parent.session, release: RELEASE });
  return { id, host, effects: makeEffects(host, { repo, gh, plat }) };
}

/** Every child item started under the parent: their item ids, from the items folder. */
export const childItems = (root) => readdirSync(join(root, 'items')).filter((f) => f.startsWith('feat-1:') && f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).sort();

/** Drive a child quick-fix from its brief to a PR at a new head, PASS and green CI. */
export async function childToPass(child, { repo, gh, n, verify = 'PASS' }) {
  const { host, effects } = child;
  if (openRun(host, 'brief')) await agentReturns(host, 'brief', BRIEFS, { gh, effects });
  const branch = buildBranch(host);
  const head = repo.commit(`pr${n}`);
  gh.open(n, { head, branch });
  gh.green(head);
  await agentReturns(host, 'build', { pr: { branch, headSha: head, url: prUrl(n) } }, { gh, effects });
  await agentReturns(host, 'verify', { result: verify, report: verify === 'PASS' ? 'ok' : 'the slice does not do it' }, { checkout: head, gh, effects });
  await wake(host, { gh, effects });
  return head;
}

export const hearParent = (parent, effects) => offer(parent, childEvents(parent, SPECS), effects);
export const tapsIn = (root, item) => transitions(root, item).filter((r) => r.source.system === 'hearth' && r.payload.outcome === 'applied').length;
