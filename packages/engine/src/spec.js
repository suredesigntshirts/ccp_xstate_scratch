// Turns a machine spec (spec/*.machine.json) into an XState machine. The JSON is plain XState config plus
// four small conventions, and this file is the whole interpreter for them:
//
// - Paths. A string like "facts.pr.v.headSha" or "event.output" reads from { facts, event };
//   { "value": x } is the literal x. Invoke input and the root output map names to paths.
// - Record (D-wildcard). A workflow has no actions. Every transition taken on an event records it as a fact,
//   context.facts[<name>] = { v | err, seen?, n }; `always` transitions record nothing. Nothing else writes context.
// - Guards. meta.guards names lists of conditions that must all hold: a path that must be present,
//   { path, is: literal }, { path, in: [literals] }, { path, same: otherPath } or { path, below: number }.
// - Needs. A state's meta.needs names the guards that must hold to enter it. Every transition into the
//   state checks them, together with its own guard, against the context as the transition's actions
//   leave it. So no state is ever entered without what it needs, and the JSON says what that is.
import { createHash } from 'node:crypto';
import { setup, assign, fromPromise, initialTransition, transition } from 'xstate';
import { check } from './schema.js';

// ---- Paths

/** The value at a dotted path, such as "facts.pr.v.headSha", or undefined. */
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

// ---- Record: the one write path (D-wildcard). Every event a transition takes becomes the fact it names.

const DONE = 'xstate.done.actor.';
const ERROR = 'xstate.error.actor.';
const AFTER = 'xstate.after.';

/** The fact an event is recorded under: the invoke id for an actor's done/error, `after` for a timer, else its type. */
export const factName = (type) =>
  type.startsWith(DONE) ? type.slice(DONE.length) : type.startsWith(ERROR) ? type.slice(ERROR.length) : type.startsWith(AFTER) ? 'after' : type;

/** The context with the event recorded as a fact: { v | err, seen?, n }. */
export const record = (context, event) => {
  const { type, output, error, seen, ...payload } = event;
  const name = factName(type);
  const prev = get(context.facts, name);
  const fact = type.startsWith(DONE) ? { v: output } : type.startsWith(ERROR) ? { err: error } : type.startsWith(AFTER) ? { v: type } : { v: payload };
  if (seen !== undefined) fact.seen = seen;
  fact.n = (prev?.n ?? 0) + 1;
  return { ...context, facts: setIn(context.facts, name.split('.'), fact) };
};

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

// A transition whose guard is its own guard, read on the facts before the record, plus the needs of the state it
// enters, read on the facts after it. An eventful transition records its event; `always` records nothing.
const bindTransition = (spec, siblings, state, transition, eventful) => {
  if (transition.actions) throw new Error('a workflow writes nothing: actions are not allowed (record is implicit)');
  const target = transition.target ? siblings[transition.target] : state;
  if (!target) throw new Error(`no state ${transition.target} beside the transition to it`);
  const needs = target.meta?.needs ?? [];
  const own = transition.guard ? [transition.guard] : [];
  const bound = { ...transition, ...(eventful ? { actions: [{ type: 'record' }] } : {}) };
  if (!needs.length && !own.length) return bound;
  bound.guard = ({ context, event }) => {
    if (failing(spec, own, { facts: context.facts, event }).length) return false;
    const after = eventful ? record(context, event) : context;
    return failing(spec, needs, { facts: after.facts, event }).length === 0;
  };
  return bound;
};

// A state, and its child states, with every transition bound. Targets are sibling state names.
const bindState = (spec, siblings, state) => {
  const bind = (transitions, eventful = true) => asList(transitions).map((t) => bindTransition(spec, siblings, state, t, eventful));
  const bindAll = (byEvent) => Object.fromEntries(Object.entries(byEvent).map(([event, t]) => [event, bind(t)]));

  const bound = { ...state };
  if (state.on) bound.on = bindAll(state.on);
  if (state.after) bound.after = bindAll(state.after);
  if (state.always) bound.always = bind(state.always, false);
  if (state.invoke) {
    const { input = {}, onDone, onError } = state.invoke;
    bound.invoke = { ...state.invoke, input: ({ context, event }) => mapPaths(input, { facts: context.facts, event }) };
    if (onDone) bound.invoke.onDone = bind(onDone);
    if (onError) bound.invoke.onError = bind(onError);
  }
  if (state.states) {
    const children = Object.entries(state.states).map(([name, child]) => [name, bindState(spec, state.states, child)]);
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
    actions: { record: assign(({ context, event }) => record(context, event)) },
    delays: spec.meta.delays ?? {}
  }).createMachine({
    ...config,
    context: ({ input }) => ({ facts: { input: { v: input, n: 1 } } }),
    ...(output ? { output: ({ context }) => mapPaths(output, { facts: context.facts }) } : {})
  });
};

// ---- Starting and replaying, without a host (ported from #110's Host#refuseStart, hashOf and replay)

/** Why an item cannot start with this input, or null: the input must match meta.input and the first state's needs must hold. */
export const startRefusal = (spec, input) => {
  const problems = check(spec.meta.input, input, spec.meta.schemas).join('; ');
  if (problems) return problems;
  const [first] = initialTransition(machineOf(spec), input);
  const needs = Object.values(first.getMeta()).flatMap((meta) => meta.needs ?? []);
  const unmet = failing(spec, needs, { facts: first.context.facts });
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
