// The items effect (D-wildcard): the run of a workflow's `items` actor. It starts child items of a named workflow,
// one per element of `each`, all at once or in order, and the host joins them (advance). A child's id is fixed by
// the parent's journal: `<run effect id with ':' -> '~'>.<k>`, and its start is sourced `engine <run id>#<k>`, so a
// child is started once whoever asks again (its file's exclusive create refuses a second start).
import { restore, offer } from '../host.js';
import { loadWorkflow as loadRepoWorkflow } from '../index.js';

const DONE = 'xstate.done.actor.';

const childrenOf = (effect) => {
  const { workflow, each, as, inOrder, ...rest } = effect.input ?? {};
  const list = each === undefined ? [] : [each].flat();
  const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return {
    workflow,
    inOrder: inOrder === true,
    inputs: list.map((child) => drop(as ? { ...rest, [as]: child } : { ...child, ...rest })),
    ids: list.map((_, k) => `${effect.id.replace(':', '~')}.${k}`)
  };
};

/**
 * The items handler. `root`, `session` and `release` are the parent's; `handlersFor(childHost)` gives the handlers a
 * child item runs its effects with; `loadWorkflow(name)` reads a workflow (the repo's workflows/ by default).
 */
export function items({ root, session, release, handlersFor, loadWorkflow = loadRepoWorkflow }) {
  const open = (workflow, id) => restore({ root, item: id, spec: loadWorkflow(workflow), session, release });
  const startOne = async (effect, workflow, id, input, k) => {
    const child = open(workflow, id);
    if (child.snapshot) return child;
    await offer(child, [{ event: { type: 'xstate.init', input }, source: { system: 'engine', ref: `${effect.id}#${k}` } }], handlersFor(child));
    return child;
  };

  const start = async (effect) => {
    const { workflow, inOrder, inputs, ids } = childrenOf(effect);
    if (!ids.length) return { ref: effect.id, children: [], output: { total: 0, done: 0, found: [], items: [] } };
    if (inOrder) await startOne(effect, workflow, ids[0], inputs[0], 0);
    else for (let k = 0; k < ids.length; k++) await startOne(effect, workflow, ids[k], inputs[k], k);
    return { ref: effect.id, children: ids };
  };

  /**
   * For each open items run of `host` (only when this session owns it): start the next in-order child once the one
   * before it ended in `done`, and when the join is complete return the run's done event as a host input.
   */
  const advance = async (host) => {
    if (host.owner && host.owner !== host.session) return [];
    const inputs = [];
    for (const run of host.runs.values()) {
      if (run.actor !== 'items') continue;
      const started = host.effects.get(run.id);
      if (started?.phase !== 'done') continue; // its start effect has not run here yet
      const { workflow, inOrder, inputs: childInputs, ids } = childrenOf(run);
      const kids = ids.map((id) => open(workflow, id));
      let complete;
      if (inOrder) {
        complete = true;
        for (let k = 0; k < ids.length; k++) {
          const s = kids[k].snapshot;
          if (!s) {
            kids[k] = await startOne(run, workflow, ids[k], childInputs[k], k);
            complete = false;
            break;
          }
          if (s.status !== 'done') { complete = false; break; }
          if (s.value !== 'done') break; // ended in another final: the walk ends here
        }
      } else {
        complete = kids.every((c) => c.snapshot?.status === 'done');
      }
      if (!complete) continue;
      const list = kids.map((c, k) => ({
        item: ids[k],
        state: c.snapshot ? (typeof c.snapshot.value === 'string' ? c.snapshot.value : JSON.stringify(c.snapshot.value)) : 'not-started',
        output: c.snapshot?.output ?? null
      }));
      const ok = list.filter((i) => i.state === 'done');
      inputs.push({
        event: { type: DONE + run.invoke, output: { total: ids.length, done: ok.length, found: ok.map((i) => i.output), items: list } },
        run: run.id,
        source: { system: 'engine', ref: `${run.id}:joined` }
      });
    }
    return inputs;
  };

  return { start, find: start, advance };
}
