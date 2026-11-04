// Child items (design A, 4.2): an invoke whose src names a workflow starts a child item. The child's id is the run's
// effect id, so it is deterministic, and its seq-0 row is created exclusively (host.js persist), so two starts make one
// child. The child's final output comes back to the parent as the invoke's done event (childResults).
import { existsSync } from 'node:fs';
import { restore, offer, itemFile } from '../host.js';
import { resultsOf, runOf } from '../actors.js';
import { workflowOf, loadWorkflow } from '../index.js';

/** The run handler for a workflow actor, for the parent `host`. handlersFor(childHost) gives the child's handlers. */
export const item = ({ host, load = loadWorkflow, handlersFor }) => ({
  async start(effect) {
    const child = effect.id;
    const spec = workflowOf(host.root, child) ?? load(effect.actor, { root: host.root });
    const c = restore({ root: host.root, item: child, spec, session: host.session, release: host.release });
    if (!c.snapshot) {
      await offer(c, [{ event: { type: 'xstate.init', input: effect.input }, source: { system: 'item', ref: effect.id } }], handlersFor(c));
    }
    if (!c.snapshot) throw new Error(`child ${child} refused its input`);
    return { ref: child };
  },
  find: (effect) => (existsSync(itemFile(host.root, effect.id)) ? { ref: effect.id } : null)
});

const restoreItem = (root, id, { session, release }) => {
  const spec = workflowOf(root, id);
  if (!spec) return null;
  return restore({ root, item: id, spec, session, release });
};

const isChild = (host, run) => existsSync(itemFile(host.root, run.id));

/** The done events of an item's finished children, for the caller to offer (as resultsOf does for agents). */
export function childResults(host) {
  return [...host.runs.values()].filter((run) => isChild(host, run)).flatMap((run) => {
    const c = restoreItem(host.root, run.id, host);
    return c?.snapshot?.status === 'done'
      ? [{ event: { type: `xstate.done.actor.${run.invoke}`, output: c.snapshot.output }, run: run.id, source: { system: 'item', ref: `${run.id}#final` } }]
      : [];
  });
}

/** After an offer to `item`: if it is final and a child, offer childResults to its parent, and settle the parent. */
export async function settle({ root, item: id, session, release, handlersFor }) {
  const c = restoreItem(root, id, { session, release });
  if (c?.snapshot?.status !== 'done') return [];
  const parentId = runOf(id)?.item;
  if (!parentId || !existsSync(itemFile(root, parentId))) return [];
  const parent = restoreItem(root, parentId, { session, release });
  const results = await offer(parent, childResults(parent), handlersFor(parent));
  return [...results, ...(await settle({ root, item: parentId, session, release, handlersFor }))];
}

/** The items a wake is offered to: the top item and, recursively, the children its open runs name. */
export const openItems = (root, top, opts = {}) => {
  const host = restoreItem(root, top, opts);
  if (!host) return [];
  return [top, ...[...host.runs.values()].filter((run) => isChild(host, run)).flatMap((run) => openItems(root, run.id, opts))];
};

/**
 * The driver (4.2): offer `inputsFor(host)` (a wake's inputs, read per item) to every open item once, then each item's
 * accepted agent results and finished children, until nothing more applies. Returns every offer's { item, outcome, row }.
 */
export async function pump({ root, top, session, release, handlersFor, inputsFor = () => [] }) {
  const all = [];
  let first = true;
  for (;;) {
    let applied = false;
    for (const id of openItems(root, top, { session, release })) {
      const host = restoreItem(root, id, { session, release });
      const inputs = [...(first ? inputsFor(host) : []), ...resultsOf(host), ...childResults(host)];
      const results = await offer(host, inputs, handlersFor(host));
      for (const r of results) all.push({ item: id, ...r });
      if (results.some((r) => r.outcome === 'applied')) applied = true;
    }
    first = false;
    if (!applied) return all;
  }
}
