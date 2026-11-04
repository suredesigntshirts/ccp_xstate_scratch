// Tourney lane E (option B part: child items and fan-out). The run of a workflow's `start` actor starts child items,
// each its own item with its own journal file, pin and owner (the parent's session). Its input is
// { workflow, list, at?, ...rest }: with `at` it starts the one child for list[at], without it one child per entry
// (fan-out). A child's item id is `<run effect id>.<index>`, so starting it again finds the child that exists: start
// is idempotent by id, and a parent restored mid-start never starts a slice twice. The run stays open; the parent
// hears each child through childEvents(), a `child.ended` event whose source is the child's final transition.
import { restore, offer } from '../host.js';

const ids = (effect) => {
  const { list = [], at = null } = effect.input ?? {};
  return (at != null ? [at] : list.map((_, i) => i)).map((i) => ({ index: i, item: `${effect.id}.${i}` }));
};

/**
 * The start handler. `parent` is the parent's host, `specs` the workflows by name, `handlersFor(child)` the effect
 * handlers a child runs with.
 */
export const children = ({ parent, specs, handlersFor = () => ({}) }) => {
  const start = async (effect) => {
    const { workflow, list = [], at: _, ...rest } = effect.input ?? {};
    const spec = specs[workflow];
    if (!spec) throw new Error(`no workflow ${workflow} to start children of`);
    const made = [];
    for (const { index, item } of ids(effect)) {
      const child = restore({ root: parent.root, item, spec, session: parent.session, release: parent.release });
      if (!child.snapshot) {
        const init = { event: { type: 'xstate.init', input: { ...rest, ...list[index] } }, source: { system: 'engine', ref: `${effect.id} start ${index}` } };
        await offer(child, [init], handlersFor(child));
      }
      made.push(item);
    }
    return { ref: effect.id, children: made };
  };
  // Start is idempotent by child id, so a host that stopped mid-start looks the children up by starting them again.
  return { start, find: start };
};

/** The children of the parent's open start runs that reached a final state, as `child.ended` inputs. */
export function childEvents(parent, specs) {
  const inputs = [];
  for (const run of parent.runs.values()) {
    const children = parent.effects.get(run.id)?.outcome?.children;
    if (!Array.isArray(children)) continue;
    for (const [index, item] of children.entries()) {
      const child = restore({ root: parent.root, item, spec: specs[run.input?.workflow], session: parent.session, release: parent.release });
      if (child.snapshot?.status !== 'done') continue;
      inputs.push({
        event: { type: 'child.ended', observed: { child: item, index: run.input?.at ?? index, state: child.snapshot.value, output: child.snapshot.output ?? null } },
        source: { system: 'engine', ref: `${item}#${child.seq - 1}` }
      });
    }
  }
  return inputs;
}
