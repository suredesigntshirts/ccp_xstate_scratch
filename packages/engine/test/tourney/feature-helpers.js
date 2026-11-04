// Shared steps for the feature scenarios (F1, F2): a feature item whose slices are quick-fix child items.
import assert from 'node:assert/strict';
import { BRIEFS, attested, returned, suiteWake, inputsOfWakeFor, tap, prOut, verdictOut, openRunOf, loadWorkflow, transitions } from './world.js';

export const GOAL = { url: 'https://github.com/o/r/issues/20', expect: ['the whole feature: multiply and divide both exported and documented'] };
export const SLICES = [
  { url: 'https://github.com/o/r/issues/20#s1', expect: ['multiply exported'] },
  { url: 'https://github.com/o/r/issues/20#s2', expect: ['divide exported'] },
  { url: 'https://github.com/o/r/issues/20#s3', expect: ['both documented'] }
];
export const PLAN = { branch: 'feature/x', slices: SLICES };
export const feature = () => loadWorkflow('feature');

/** Start feature f-1 and return its plan; f-1 is then slicing with child 0 started. */
export async function planned(w) {
  let { host } = await w.startItem('f-1', { goal: GOAL }, feature());
  assert.equal(host.snapshot.value, 'planning');
  ({ host } = await w.send('f-1', [returned(host, 'plan', PLAN)], feature()));
  assert.equal(host.snapshot.value, 'slicing');
  const run = openRunOf(host, 'slices');
  const child = (k) => `${run.id.replace(':', '~')}.${k}`;
  return { host, child };
}

/** Take quick-fix item `id` through briefs and a build of PR n at head. */
export async function built(w, id, n, head, gh) {
  let kid = w.open(id);
  if (kid.snapshot.value === 'briefing') ({ host: kid } = await w.send(id, [returned(kid, 'briefs', BRIEFS)]));
  ({ host: kid } = await w.send(id, [(await attested(kid, 'pr', prOut(n, head, gh.state[n].branch), { gh, worktreeHead: head })).input]));
  assert.equal(kid.snapshot.value, 'checking');
  return kid;
}

/** Verify PR n at head with `result`, then CI green on it. */
export async function verified(w, id, n, head, result, gh) {
  let kid = w.open(id);
  ({ host: kid } = await w.send(id, [(await attested(kid, 'verify', verdictOut(result, n, head), { gh, worktreeHead: head })).input]));
  if (result === 'PASS') ({ host: kid } = await w.send(id, inputsOfWakeFor(kid, suiteWake(head, n))));
  return kid;
}

/** A slice that passes: build, PASS, green; it merges into its base with no card. */
export async function passingSlice(w, id, n, head, gh) {
  gh.add(n, { head, branch: `build/${n}`, base: 'feature/x' });
  await built(w, id, n, head, gh);
  const kid = await verified(w, id, n, head, 'PASS', gh);
  assert.equal(kid.snapshot.value, 'done', `${id} merged into feature/x with no card`);
  return kid;
}

/** Person taps (hearth-sourced applied transitions) across every item under root. */
export const tapsIn = (root, items) => items.flatMap((i) => transitions(root, i)).filter((r) => r.source.system === 'hearth' && r.payload.outcome === 'applied').length;
export { tap };
