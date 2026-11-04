// The host: one item's workflow, driven by what reaches it from outside. restore() rebuilds the item from its one
// journal file, applyEvent() takes one event from its source, persist() appends the rows, and runEffects() carries
// out what the transition asked for, once per effect id. Ported from ccp_machine PR #110 (host.js, driver.js,
// step.js); why it is shaped this way is in plan/items/engine-host.md and plan/decisions/2026-10-30-engine-host.md.
//
// XState's pure transition() runs nothing: it returns the actions a step would run. The host turns four of them
// into effects for the outside world, each with an id that names it for good:
//   xstate.spawnChild -> run     start an invoked actor's work         <item>:<seq>.<invoke id>
//   xstate.stopChild  -> stop    its state was left; drop its result   <run effect id>:stop
//   delayed raise     -> timer   send the event when it is due        <item>:<seq>.<timer id>
//   xstate.cancel     -> cancel  the timer's state was left            <timer effect id>:cancel
//
// Rows (docs/journal.md, "Engine rows"): every event offered to the item makes one engine.transition row, applied
// or not, and every effect makes an engine.effect row when it starts and one when it ends.
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { initialTransition, transition } from 'xstate';
import { append, readFile } from '../../journal/src/index.js';
import { machineOf, hashOf, startRefusal } from './spec.js';
import { check } from './schema.js';

const START = 'xstate.init';
const DONE = 'xstate.done.actor.'; // + the invoke's id: the actor finished, with event.output
const ERROR = 'xstate.error.actor.'; // + the invoke's id: the actor failed, with event.error
const TIMER = 'xstate.after.'; // the event a delayed transition's timer sends
const TERMINAL = ['done', 'refused', 'failed', 'unknown'];

/** The one file an item's journal lives in. Restore reads it by this path and never lists a folder. */
export const itemFile = (root, item) => join(root, 'items', `${item}.jsonl`);
/** A session's own journal file, where it records what it was refused for an item it does not own. */
export const sessionFile = (root, session) => join(root, 'sessions', `${session}.jsonl`);

/** Thrown when another session made the item's file between this host's restore and its first write. */
export class OwnedError extends Error {
  constructor(file) {
    super(`another session already owns ${file}`);
    this.name = 'OwnedError';
  }
}

/**
 * The item as its journal leaves it: { item, spec, session, release, owner, snapshot, seq, runs, timers, effects,
 * seen, file, root }. owner is the session that started it, or null when it has not started. Throws when an applied
 * transition replays to another hash than it recorded: the workflow changed under the item.
 */
export function restore({ root, item, spec, session, release }) {
  const file = itemFile(root, item);
  let rows = [];
  try {
    rows = readFile(file).rows;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const host = {
    root, item, spec, session, release, file,
    machine: machineOf(spec),
    owner: null,
    snapshot: null,
    seq: 0,
    runs: new Map(), // run effect id -> the run effect: actors started and not yet finished
    timers: new Map(), // timer id -> the timer effect: timers set and not yet fired or cancelled
    effects: new Map(), // effect id -> { effect, phase, outcome }
    seen: new Set() // `${source.system} ${source.ref}` of every event the item has taken or turned away
  };

  const transitions = rows.filter((r) => r.kind === 'engine.transition');
  for (const row of transitions) host.seen.add(sourceKey(row.source));
  const applied = transitions.filter((r) => r.payload.outcome === 'applied').sort((a, b) => a.payload.seq - b.payload.seq);
  for (const row of applied) {
    if (row.payload.seq === 0) host.owner = row.session;
    const { hash, effects } = step(host, row.payload.event, row.payload.run, row.at);
    if (hash !== row.payload.hash) {
      throw new Error(`${row.payload.transition} replays to ${hash}, not ${row.payload.hash}: the workflow changed`);
    }
    for (const effect of effects) host.effects.set(effect.id, { effect, phase: null, outcome: null });
  }
  for (const row of rows.filter((r) => r.kind === 'engine.effect')) {
    const known = host.effects.get(row.payload.effect);
    if (!known) continue;
    // A row ending the effect wins over its start, whatever order equal times read back in.
    if (TERMINAL.includes(known.phase) && !TERMINAL.includes(row.payload.phase)) continue;
    known.phase = row.payload.phase;
    known.outcome = row.payload.outcome ?? null;
  }
  return host;
}

/**
 * Offer one event to the item: { event, source, run?, at? }. source is { system, ref } from where the event came:
 * the wake envelope, the timer the host set, or the effect that finished (see wake.js). Returns { outcome, row,
 * effects }: outcome is applied, duplicate, stale, refused or not-owner, row is the engine.transition row to
 * persist, and effects are what an applied transition asks for. Changes the host only when applied.
 */
export function applyEvent(host, { event, source, run = null, at = new Date().toISOString() }) {
  const turnedAway = (outcome, reason, file = host.file) => ({
    outcome,
    effects: [],
    row: transitionRow(host, { outcome, reason, event, source, run, at, file, seq: null })
  });

  if (!ownedHere(host)) {
    return turnedAway('not-owner', `${host.item} is owned by ${host.owner}`, sessionFile(host.root, host.session));
  }
  if (!source?.system || !source?.ref) return turnedAway('refused', 'the event has no source', sessionFile(host.root, host.session));
  if (!host.snapshot && event?.type !== START) {
    return turnedAway('refused', `${host.item} has not started`, sessionFile(host.root, host.session));
  }
  if (host.seen.has(sourceKey(source))) return turnedAway('duplicate', `${source.system} ${source.ref} was already offered`);

  const reason = refusal(host, event, run);
  if (reason) {
    host.seen.add(sourceKey(source));
    return turnedAway(reason.stale ? 'stale' : 'refused', reason.why);
  }

  const seq = host.seq;
  const from = host.snapshot?.value ?? null;
  const { hash, effects } = step(host, event, run, at);
  for (const effect of effects) host.effects.set(effect.id, { effect, phase: null, outcome: null });
  if (seq === 0) host.owner = host.session;
  host.seen.add(sourceKey(source));
  const row = transitionRow(host, { outcome: 'applied', event, source, run, at, seq, from, hash, file: host.file });
  return { outcome: 'applied', row, effects };
}

/**
 * Append rows, each to its own file: the item's file, or for an event the item turned away from a session that
 * does not own it, that session's file. The item's first row creates its file exclusively, so a second host that
 * raced it is refused with OwnedError.
 */
export function persist(host, rows) {
  for (const { file, ...row } of [rows].flat()) {
    mkdirSync(join(file, '..'), { recursive: true });
    if (row.kind === 'engine.transition' && row.payload.seq === 0) {
      try {
        closeSync(openSync(file, 'wx'));
      } catch (error) {
        if (error.code === 'EEXIST') throw new OwnedError(file);
        throw error;
      }
    }
    append(file, row);
  }
}

/**
 * Carry out the effects not yet ended, once each by effect id, with handlers keyed by effect type: { run, stop,
 * timer, cancel }, each { start(effect) -> outcome, find?(effect) -> outcome or null }. An outcome is {} or
 * { ref, output, source, choices } when the effect worked, or { refused: { rule, text } } when something refused it.
 * An effect whose type has no handler, or whose handler's handles?(effect) says no, stays pending for a host that
 * has one. The handlers for merge, card, post and timer are in effects/ (plan item engine-effects).
 *
 * An effect that started and never ended (the host stopped mid-effect) is not started again blindly: find() asks the
 * world whether it happened. With no find(), it is journalled unknown and left alone. A refused effect is journalled
 * with its rule and never retried; a refused or failed run sends its actor's error event, so the item steps back.
 *
 * Only the item's owner carries out its effects. A host restored by another session runs none of them and writes
 * nothing to the item's file, so a card, post, run, timer or merge the owner has open is started by the owner alone
 * (plan item fix-other-host-runs-effects, case C-two-hosts-one-item). Its events are turned away by applyEvent.
 *
 * Returns { rows, follow }: the engine.effect rows written, and the events to apply next (completions with output).
 */
export async function runEffects(host, handlers = {}) {
  const rows = [];
  const follow = [];
  if (!ownedHere(host)) return { rows, follow };
  const write = (effect, phase, extra = {}) => {
    const row = effectRow(host, effect, phase, extra);
    persist(host, row);
    rows.push(row);
    const known = host.effects.get(effect.id);
    known.phase = phase;
    known.outcome = extra.outcome ?? null;
  };

  for (const { effect, phase } of [...host.effects.values()]) {
    if (TERMINAL.includes(phase)) continue;
    const handler = handlers[effect.type];
    if (!handler || (handler.handles && !handler.handles(effect))) continue;
    if (effect.type === 'run' && !host.runs.has(effect.id)) continue; // already finished or stopped

    let outcome;
    if (phase === 'start') {
      const found = handler.find ? await handler.find(effect) : undefined;
      if (found === undefined) {
        write(effect, 'unknown', { reason: 'the host stopped mid-effect and the effect has no way to look it up' });
        continue;
      }
      if (found) outcome = { ...found, found: true };
    }
    if (!outcome) {
      write(effect, 'start');
      try {
        outcome = (await handler.start(effect)) ?? {};
      } catch (error) {
        write(effect, 'failed', { reason: String(error?.message ?? error) });
        if (effect.type === 'run') follow.push(stepBack(effect, 'failed', `failed: ${error?.message ?? error}`));
        continue;
      }
    }

    if (outcome.refused) {
      const rule = outcome.refused.rule ?? 'unnamed rule';
      write(effect, 'refused', { rule, outcome: { refused: outcome.refused } });
      if (effect.type === 'run') follow.push(stepBack(effect, 'refused', `refused by ${rule}`));
      continue;
    }
    const { output, source, ...kept } = outcome;
    write(effect, 'done', { outcome: kept });
    if (effect.type === 'run' && output !== undefined) {
      follow.push({
        event: { type: DONE + effect.invoke, output },
        run: effect.id,
        source: source ?? { system: 'engine', ref: effect.id }
      });
    }
  }
  return { rows, follow };
}

/**
 * Offer inputs to the item in turn: first carry out effects a stopped host left open (only as the owner), then for each input apply,
 * persist and run the effects, and apply what those effects send back. Returns each input's { outcome, row }.
 * When another session made the item's file first, the item is restored again and the input is turned away.
 */
export async function offer(host, inputs, handlers = {}) {
  const results = [];
  const queue = [...(await runEffects(host, handlers)).follow, ...inputs];
  while (queue.length) {
    const input = queue.shift();
    let result = applyEvent(host, input);
    try {
      persist(host, result.row);
    } catch (error) {
      if (!(error instanceof OwnedError)) throw error;
      Object.assign(host, restore(host));
      host.owner ??= `another session (its first row is not visible here yet, but ${host.file} exists)`;
      result = applyEvent(host, input);
      persist(host, result.row);
    }
    results.push({ outcome: result.outcome, row: result.row });
    if (result.outcome === 'applied') queue.push(...(await runEffects(host, handlers)).follow);
  }
  return results;
}

/** What the item is waiting on: the effects not yet ended, and the runs and timers still open. */
export const pending = (host) => ({
  effects: [...host.effects.values()].filter((e) => !TERMINAL.includes(e.phase)).map((e) => e.effect),
  runs: [...host.runs.values()],
  timers: [...host.timers.values()]
});

// ---- Inside

const sourceKey = ({ system, ref }) => `${system} ${ref}`;

// Whether this host's session may act for the item: it owns it, or nobody does yet (nothing is open then).
const ownedHere = (host) => !host.owner || host.owner === host.session;

// The error event that steps a run's item back when its effect was refused or failed. Its source is the effect.
const stepBack = (effect, ended, error) => ({
  event: { type: ERROR + effect.invoke, error },
  run: effect.id,
  source: { system: 'engine', ref: `${effect.id}:${ended}` }
});

// Why the item cannot take this event now, or null. Each kind of event has its own check, and then the machine
// must take it in the state it is in.
function refusal(host, event, run) {
  const type = event?.type;
  if (typeof type !== 'string') return { why: 'the event has no type' };
  if (type === START) return host.snapshot ? { why: `${host.item} has started` } : nullOr(startRefusal(host.spec, event.input));
  if (host.snapshot.status === 'done') return { why: `${host.item} is done` };

  if (type.startsWith(DONE) || type.startsWith(ERROR)) {
    const open = run && host.runs.get(run);
    const invoke = type.slice((type.startsWith(DONE) ? DONE : ERROR).length);
    if (!open || open.invoke !== invoke) return { stale: true, why: `run ${run ?? '(none)'} is not in flight for ${type}` };
    if (type.startsWith(DONE)) {
      const problems = problemsOf(host, host.spec.meta.actors[open.actor], event.output);
      if (problems) return { why: `${open.actor} output: ${problems}` };
    }
  } else if (type.startsWith(TIMER)) {
    if (!host.timers.has(type)) return { stale: true, why: `no timer ${type} is set` };
  } else {
    const schema = host.spec.meta.events?.[type];
    if (!schema) return { why: `${type} is not an event ${host.spec.id} takes from outside` };
    const { type: _, ...payload } = event;
    const problems = problemsOf(host, schema, payload);
    if (problems) return { why: `${type}: ${problems}` };
  }
  return host.snapshot.can(event) ? null : { why: `${type} is not taken in ${JSON.stringify(host.snapshot.value)}` };
}

const nullOr = (why) => (why ? { why } : null);
const problemsOf = (host, schema, value) => check(schema, value, host.spec.meta.schemas).join('; ');

// Step the machine and keep the host's record of what is open. A finished run and a fired timer close first, so
// leaving their state emits no stop or cancel for them. Used for live events and for replay alike.
function step(host, event, run, at) {
  const seq = host.seq;
  if (run) host.runs.delete(run);
  if (event.type.startsWith(TIMER)) host.timers.delete(event.type);
  const [snapshot, actions] = event.type === START
    ? initialTransition(host.machine, event.input)
    : transition(host.machine, host.snapshot, event);
  host.snapshot = snapshot;
  host.seq = seq + 1;
  const effects = actions.flatMap((action) => effectOf(host, action, seq, at));
  return { hash: hashOf(snapshot), effects };
}

function effectOf(host, action, seq, at) {
  return effectsOf(host, action, seq, at).map((effect) => ({ ...effect, transition: `${host.item}#${seq}` }));
}

function effectsOf(host, { type, params }, seq, at) {
  switch (type) {
    case 'xstate.spawnChild': {
      const effect = { id: `${host.item}:${seq}.${params.id}`, type: 'run', invoke: params.id, actor: params.src, input: params.input };
      host.runs.set(effect.id, effect);
      return [effect];
    }
    case 'xstate.stopChild': {
      const open = [...host.runs.values()].find((r) => r.invoke === params.id);
      if (!open) return [];
      host.runs.delete(open.id);
      return [{ id: `${open.id}:stop`, type: 'stop', run: open.id }];
    }
    case 'xstate.raise': {
      if (params.delay == null) return [];
      const due = new Date(Date.parse(at) + params.delay).toISOString();
      const effect = { id: `${host.item}:${seq}.${params.id}`, type: 'timer', timer: params.id, event: params.event, due };
      host.timers.set(params.id, effect);
      return [effect];
    }
    case 'xstate.cancel': {
      const open = host.timers.get(params.sendId);
      if (!open) return [];
      host.timers.delete(params.sendId);
      return [{ id: `${open.id}:cancel`, type: 'cancel', timer: open.timer }];
    }
  }
  return [];
}

function transitionRow(host, { outcome, reason = null, event, source, run, at, seq, from = null, hash = null, file }) {
  const applied = outcome === 'applied';
  return {
    file,
    ...(applied ? { id: `${host.item}#${seq}` } : {}),
    at,
    kind: 'engine.transition',
    source: { system: String(source?.system ?? 'none'), ref: String(source?.ref ?? 'none') },
    session: host.session,
    item: host.item,
    state: host.snapshot ? JSON.stringify(host.snapshot.value) : null,
    release: host.release,
    payload: {
      transition: applied ? `${host.item}#${seq}` : null,
      seq,
      outcome,
      reason,
      workflow: host.spec.id,
      event,
      run,
      from: from === null ? null : JSON.stringify(from),
      hash
    }
  };
}

function effectRow(host, effect, phase, { outcome = null, rule = null, reason = null } = {}) {
  return {
    file: host.file,
    kind: 'engine.effect',
    source: { system: 'engine', ref: effect.id },
    session: host.session,
    item: host.item,
    state: host.snapshot ? JSON.stringify(host.snapshot.value) : null,
    release: host.release,
    payload: {
      effect: effect.id,
      type: effect.type,
      phase,
      transition: effect.transition,
      ...(effect.actor ? { actor: effect.actor } : {}),
      ...(effect.timer ? { timer: effect.timer, due: effect.due ?? null } : {}),
      outcome,
      rule,
      reason
    }
  };
}
