// Turns a machine spec (spec/*.machine.json) into an XState machine. The JSON is plain XState config plus
// four small conventions, and this file is the whole interpreter for them:
//
// - Paths. A string like "context.pr.headSha" or "event.output" reads from { context, event };
//   { "value": x } is the literal x. Invoke input and the root output map names to paths.
// - Context op. Actions are { type: "set", params: { "<context path>": <path or value> } }. Every source in one
//   set reads the context as it was before that set, so { b: "context.a", a: x } shifts a into b (design A,
//   round 2: a bounded loop is a short shift register, and `inc` is gone). Nothing else writes context.
// - Guards. meta.guards names lists of conditions that must all hold: a path that must be present,
//   { path, is: literal }, { path, in: [literals] }, { path, same: otherPath } or { path, below: number }.
// - Needs. A state's meta.needs names the guards that must hold to enter it. Every transition into the
//   state checks them, together with its own guard, against the context as the transition's actions
//   leave it. So no state is ever entered without what it needs, and the JSON says what that is.
// - Wrote marks. Every set action is followed by a `wrote` marker carrying its params and its JSON pointer in the
//   workflow file. XState runs assign actions inside transition() and does not return them; the marker is how the
//   host learns which context paths a step wrote and from where, and journals them (stage-contract cleanup, item F).
import { createHash } from 'node:crypto';
import { setup, assign, fromPromise, initialTransition, transition } from 'xstate';
import { check } from './schema.js';
import { esc } from './stages.js';

// ---- Paths

/** The value at a dotted path, such as "context.pr.headSha", or undefined. */
export const get = (root, path) => path.split('.').reduce((value, key) => value?.[key], root);

// A source is a path to read, or { value } for a literal.
const resolve = (source, scope) => (typeof source === 'string' ? get(scope, source) : source?.value);

/** { name: source } as { name: value }, each source read from scope. */
export const mapPaths = (map, scope) =>
  Object.fromEntries(Object.entries(map).map(([name, source]) => [name, resolve(source, scope)]));

// A copy of obj with value at the path given as a list of keys.
const setIn = (obj, [key, ...rest], value) => ({
  ...obj,
  [key]: rest.length ? setIn(obj?.[key] ?? {}, rest, value) : value
});

// ---- Context ops

const ops = {
  set: (context, event, params) =>
    Object.entries(params).reduce(
      (next, [path, source]) => setIn(next, path.split('.'), resolve(source, { context, event })),
      context
    )
};

// The context as a transition's actions leave it.
const applyActions = (context, event, actions) =>
  actions.reduce((next, { type, params }) => ops[type](next, event, params), context);

// ---- Guards

const present = (value) => value != null && value !== '' && !(Array.isArray(value) && value.length === 0);

const holds = (condition, scope) => {
  if (typeof condition === 'string') return present(get(scope, condition));
  const value = get(scope, condition.path);
  if ('is' in condition) return value === condition.is;
  if ('in' in condition) return condition.in.includes(value);
  if ('same' in condition) return present(value) && value === get(scope, condition.same);
  if ('below' in condition) return typeof value === 'number' && value < condition.below;
  throw new Error(`unknown condition ${JSON.stringify(condition)}`);
};

/** The guards (by name) that fail for { context, event }; empty when all hold. */
export const failing = (spec, names, scope) =>
  names.filter((name) => !spec.meta.guards[name].every((condition) => holds(condition, scope)));

// ---- Needs: binding each transition to its own guard and its target's needs

// A transition as XState takes it (a target, an object, or a list of either), as a list of objects.
const asList = (transitions) => [transitions].flat().map((t) => (typeof t === 'string' ? { target: t } : t));

// A transition whose guard is its own guard plus the needs of the state it enters, checked against the
// context as its actions will leave it. A transition without a target stays, and keeps its state's needs.
const bindTransition = (spec, siblings, state, transition, at) => {
  const target = transition.target ? siblings[transition.target] : state;
  if (!target) throw new Error(`no state ${transition.target} beside the transition to it`);
  const names = [...(transition.guard ? [transition.guard] : []), ...(target.meta?.needs ?? [])];
  const actions = [transition.actions ?? []].flat();
  const marked = actions.length ? { ...transition, actions: marks(actions, Array.isArray(transition.actions) ? `${at}/actions` : null, at) } : transition;
  if (!names.length) return marked;
  const guard = ({ context, event }) => {
    const after = applyActions(context, event, actions);
    return failing(spec, names, { context: after, event }).length === 0;
  };
  return { ...marked, guard };
};

// Each set action followed by its wrote marker: { at: the set's JSON pointer, writes: its params }. `list` is the
// pointer of the transition's actions list; null when actions is a single action, whose pointer is `${at}/actions`.
const marks = (actions, list, at) =>
  actions.flatMap((a, j) => (a.type === 'set' ? [a, { type: 'wrote', params: { at: list ? `${list}/${j}` : `${at}/actions`, writes: a.params } }] : [a]));

// A state, and its child states, with every transition bound. Targets are sibling state names.
// `at` is the state's JSON pointer in the workflow file, so each wrote marker can name where its set action is.
const bindState = (spec, siblings, state, at = '') => {
  const bind = (transitions, where) => {
    const many = Array.isArray(transitions);
    return asList(transitions).map((t, i) => bindTransition(spec, siblings, state, t, many ? `${where}/${i}` : where));
  };
  const bindAll = (byEvent, where) =>
    Object.fromEntries(Object.entries(byEvent).map(([event, t]) => [event, bind(t, `${where}/${esc(event)}`)]));

  const bound = { ...state };
  if (state.on) bound.on = bindAll(state.on, `${at}/on`);
  if (state.after) bound.after = bindAll(state.after, `${at}/after`);
  if (state.invoke) {
    const one = (invoke, where) => {
      const { input = {}, onDone, onError } = invoke;
      const b = { ...invoke, input: (scope) => mapPaths(input, scope) };
      if (onDone) b.onDone = bind(onDone, `${where}/onDone`);
      if (onError) b.onError = bind(onError, `${where}/onError`);
      return b;
    };
    bound.invoke = Array.isArray(state.invoke) ? state.invoke.map((inv, i) => one(inv, `${at}/invoke/${i}`)) : one(state.invoke, `${at}/invoke`);
  }
  if (state.states) {
    const children = Object.entries(state.states).map(([name, child]) => [name, bindState(spec, state.states, child, `${at}/states/${esc(name)}`)]);
    bound.states = Object.fromEntries(children);
  }
  return bound;
};

// ---- The machine

/** The XState machine for a spec. Actors never run here: a host reads their start from transition()'s actions. */
export const machineOf = (spec) => {
  const neverRuns = fromPromise(() => new Promise(() => {}));
  const actors = Object.fromEntries(Object.keys(spec.meta.actors).map((name) => [name, neverRuns]));
  const { output, ...config } = bindState(spec, {}, spec);
  return setup({
    actors,
    actions: {
      set: assign(({ context, event }, params) => ops.set(context, event, params)),
      wrote: () => {} // a marker the host reads from transition()'s actions (see "Wrote marks" above); it does nothing
    },
    delays: spec.meta.delays ?? {}
  }).createMachine({
    ...config,
    context: ({ input }) => ({ ...spec.context, ...input }),
    ...(output ? { output: (scope) => mapPaths(output, scope) } : {})
  });
};

// ---- Starting and replaying, without a host (ported from #110's Host#refuseStart, hashOf and replay)

/** Why an item cannot start with this input, or null: the input must match meta.input and the first state's needs must hold. */
export const startRefusal = (spec, input) => {
  const problems = check(spec.meta.input, input, spec.meta.schemas).join('; ');
  if (problems) return problems;
  const [first] = initialTransition(machineOf(spec), input);
  const needs = Object.values(first.getMeta()).flatMap((meta) => meta.needs ?? []);
  const unmet = failing(spec, needs, { context: first.context });
  return unmet.length ? `the initial state needs ${unmet.join(', ')}` : null;
};

/** A short hash of what the item is: its state and context. A journal entry records the one it led to. */
export const hashOf = (snapshot) => {
  const json = JSON.stringify([snapshot.value, snapshot.context]);
  return createHash('sha256').update(json).digest('hex').slice(0, 12);
};

/**
 * The snapshot a journal of inputs ({ event, hash? }, the first an xstate.init carrying input) leads to, by
 * pure transitions. Throws when an entry replays to another hash than it recorded: the workflow changed under it.
 */
export const replay = (spec, entries) => {
  const machine = machineOf(spec);
  let snapshot = null;
  for (const { seq, event, hash } of entries) {
    [snapshot] = snapshot ? transition(machine, snapshot, event) : initialTransition(machine, event.input);
    if (hash && hash !== hashOf(snapshot)) {
      throw new Error(`journal entry ${seq} replays to ${hashOf(snapshot)}, not ${hash}: the workflow changed`);
    }
  }
  return snapshot;
};
