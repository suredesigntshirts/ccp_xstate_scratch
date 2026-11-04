// The stage record (stage-contract cleanup, item F): for every model-stage run, runs/<n>.<actor>/stage.json says what
// went in and where it came from, and, once the item takes the run's result, what came out and where it went.
//
//   started:  the stage, its workflow (id, name and hash), the invoke and state that started it, the prompt as its
//             parts (stages.js sections: every piece with its source; a frame piece says fixed: true, or filled: the
//             run facts it was filled from; an input piece names its meaningAt and producer) and every input with its
//             meaning, meaningAt, value, the context path the invoke read it from and its producer;
//   finished: the transition, event and state (a list of active states, each a dotted path) that took the result,
//             then the output (or error) with stamped (the dotted paths in it the host wrote, not the agent), each
//             context path the transition wrote from it, with into (the state entered, a dotted path), replaced (the
//             producer of the value it replaced, or null over a default) and readBy (the invokes that could read it).
//
// A producer is the last write to the path an input reads (or to a whole that holds it): the run and output field of
// the stage that returned it ({ kind: 'stage', run, actor, field }), a child workflow or host effect likewise, the
// item's input ({ kind: 'initial', field }), a literal in the workflow ({ kind: 'literal', at }), an outside event
// ({ kind: 'event', event, source, field }), a copy of another path ({ kind: 'copy', from, of }), the host for a field
// it stamps on a ref a run returned ({ kind: 'host', stamped, run, actor, field }), or the context default
// ({ kind: 'default', at }). Later writes to parts of the path are listed as amended; when the base is a null default,
// the value is made of those parts alone, and the producer is { kind: 'parts', default, parts: [{ path, ...writer }] },
// the parts listed there once and not again as amended.
// readBy lists the invokes that could read a written path next (any invoke reading it that the item can reach from
// the state the write entered, by any path in the chart, taken or not), not the one that will: a later write may
// replace the value first, as replanning nulls verdict before awaitingMerge can be reached again. A reader that is
// the writing invoke itself (its state entered again, as the next build reads this build's pr as previous) is kept
// and marked self: true. A run whose state was left before it returned (its stop) ends with finished.stopped and no
// output. Every write is in the journal: the host puts each applied transition's writes in its engine.transition row
// (host.js writesOf), so the record is derived from the journal and the workflow JSON alone. Nothing here imports
// XState.
import { chart, esc, isStage, EFFECTS, readers, STAMPED } from './stages.js';

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const kindOf = (spec, actor) => (isStage(spec.meta?.actors?.[actor]) ? 'stage' : EFFECTS.includes(actor) ? 'effect' : 'workflow');
const paramAt = (w) => (w.set ? `${w.set}/params/${esc(w.path)}` : null);
/** The value at a JSON pointer in the workflow. */
const pointer = (spec, ptr) => String(ptr ?? '').split('/').slice(1).map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((v, k) => v?.[k], spec);
const join = (a, b) => [a, b].filter((x) => x != null && x !== '').join('.') || null;

/** Who last wrote `path` in a context log ([{ path, by }], oldest first): { producer, amended? }. */
export function producerOf(log, path, spec) {
  let base = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].path === path || path.startsWith(`${log[i].path}.`)) { base = i; break; }
  }
  const top = path.split('.')[0];
  let producer = { kind: 'default', at: `/context/${esc(top)}` };
  if (base >= 0) {
    const rest = path.slice(log[base].path.length + 1);
    const by = log[base].by;
    producer = rest ? (['stage', 'effect', 'workflow', 'initial'].includes(by.kind) ? { ...by, field: join(by.field, rest) } : { ...by, part: rest }) : by;
    // A field the host stamps on a ref the run returned ({ url, at }): the host wrote it at accept, not the run.
    const last = rest.split('.').pop();
    if (by.run && STAMPED.includes(last)) producer = { kind: 'host', stamped: last, run: by.run, actor: by.actor, field: producer.field, transition: by.transition, at: by.at };
  } else if (!Object.hasOwn(spec?.context ?? {}, top)) {
    producer = { kind: 'none' };
  }
  const amended = log.slice(base + 1).filter((e) => e.path.startsWith(`${path}.`));
  // A null default built up wholly from part-writes (research's answers, one per researcher): its producers are the
  // part-writers, each with the part it wrote.
  // They are listed once, under parts, and not again as amended.
  if (producer.kind === 'default' && path.split('.').reduce((v, k) => (v != null && Object.hasOwn(Object(v), k) ? v[k] : undefined), spec?.context) == null && amended.length) {
    return { producer: { kind: 'parts', default: producer.at, parts: amended.map((e) => ({ path: e.path, ...e.by })) } };
  }
  return amended.length ? { producer, amended } : { producer };
}

// The producer of one write, its sources read against the log as it was before the write's set action.
function writer(w, row, log, spec, actorOf) {
  const { event, run, transition } = row.payload;
  const at = paramAt(w);
  // A literal or a copy is written by the transition an event took: the event is named with it.
  if (isObject(w.from)) return { kind: 'literal', at: `${at}/value`, event: event?.type ?? null, transition };
  const from = String(w.from);
  if (from.startsWith('context.')) return { kind: 'copy', from, of: producerOf(log, from.slice(8), spec).producer, event: event?.type ?? null, transition, at };
  if (from.startsWith('event.input.') && event?.type === 'xstate.init') return { kind: 'initial', field: from.slice(12), transition };
  if (run && (from === 'event.output' || from.startsWith('event.output.') || from === 'event.error')) {
    const actor = actorOf.get(run) ?? null;
    const field = from === 'event.error' ? 'error' : from.slice(13) || null;
    return { kind: kindOf(spec, actor), run, actor, field, transition, at };
  }
  return { kind: 'event', event: event?.type ?? null, source: row.source, field: from.replace(/^event\.?/, '') || null, transition, at };
}

/** Every context write of an item, oldest first, up to transition seq `upto`: [{ path, by }]. From journal rows. */
export function contextLog(rows, spec, upto = Infinity) {
  const actorOf = new Map();
  for (const r of rows) if (r.kind === 'engine.effect' && r.payload?.actor) actorOf.set(r.payload.effect, r.payload.actor);
  const applied = rows
    .filter((r) => r.kind === 'engine.transition' && r.payload?.outcome === 'applied' && r.payload.seq <= upto)
    .sort((a, b) => a.payload.seq - b.payload.seq);
  const log = [];
  for (const row of applied) {
    const writes = row.payload.writes ?? [];
    for (let i = 0; i < writes.length;) {
      let j = i;
      while (j < writes.length && writes[j].set === writes[i].set) j++;
      const group = writes.slice(i, j).map((w) => ({ path: w.path, by: writer(w, row, log, spec, actorOf) }));
      log.push(...group);
      i = j;
    }
  }
  return log;
}

// True when the state at path (a list of names) is active in a snapshot value.
const active = (value, path) => {
  let v = value;
  for (const [i, seg] of path.entries()) {
    if (typeof v === 'string') return v === seg && i === path.length - 1;
    if (!isObject(v) || !(seg in v)) return false;
    v = v[seg];
  }
  return true;
};

/**
 * The started half of a run's stage record. `run` is the run (actors.js prepare: actor, invoke, input, ...), `parts`
 * its prompt sections, `value` the item's state value when the run started, and `rows` the item's journal.
 */
export function stageRecord({ spec, run, parts, promptHash, value, rows, transition }) {
  const seq = Number(String(transition ?? '').split('#').pop());
  const log = contextLog(rows, spec, Number.isFinite(seq) ? seq : Infinity);
  const candidates = chart(spec).invokes.filter((inv) => inv.id === run.invoke && inv.src === run.actor);
  const inv = candidates.find((c) => active(value, c.state)) ?? candidates[0] ?? { at: null, state: [], input: {} };
  const [name, hash] = String(spec.id).split('@');
  const stage = spec.meta.actors[run.actor];
  const inputs = Object.entries(stage.inputs).map(([k, meaning]) => {
    const from = inv.input[k];
    const wiredAt = inv.at && `${inv.at}/input/${esc(k)}`;
    const source = isObject(from)
      ? { producer: { kind: 'literal', at: `${wiredAt}/value` } }
      : typeof from === 'string' && from.startsWith('context.') ? producerOf(log, from.slice(8), spec) : { producer: { kind: 'none' } };
    return { name: k, meaning, meaningAt: `/meta/actors/${esc(run.actor)}/inputs/${esc(k)}`, value: run.input?.[k] ?? null, from: from ?? null, wiredAt, ...source };
  });
  const byName = Object.fromEntries(inputs.map((i) => [i.name, i]));
  const tagged = Object.fromEntries(Object.entries(parts).map(([part, pieces]) => [part, pieces.map((p) =>
    p.source.input ? { ...p, source: { ...p.source, from: byName[p.source.input]?.from ?? null, producer: byName[p.source.input]?.producer ?? null } } : p)]));
  return {
    run: run.run,
    stage: run.actor,
    invoke: run.invoke,
    state: inv.state.join('.'),
    invokeAt: inv.at,
    workflow: { id: spec.id, name, hash: hash ?? null },
    started: transition ?? null,
    prompt: { hash: promptHash, parts: tagged },
    inputs
  };
}

// Every field the host stamped on a ref { url, at } in an accepted output: their dotted paths, below the output. An
// agent may not set them (actors.js accept refuses a ref carrying one), so each one present was written by the host.
function stampedIn(value, path = []) {
  if (!value || typeof value !== 'object') return [];
  const ref = typeof value.url === 'string' && typeof value.at === 'string';
  return Object.entries(value).flatMap(([k, v]) =>
    ref && STAMPED.includes(k) ? [[...path, k].join('.')] : stampedIn(v, [...path, k]));
}

// The active states of a state value, each a dotted path: one, unless the chart has parallel regions.
const leaves = (value, path = []) => (isObject(value)
  ? Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]))
  : [[...path, value].join('.')]);

/**
 * The finished half: what the applied done or error transition `row` took from the run, what each write replaced
 * (`rows`, the item's journal, gives the producers before it), and who could read it next: the invokes in the chart
 * that read a written path and that the item can reach from the state the transition entered. The writing invoke's
 * own reads are marked self: true (a later entry of the same state, as the next build reads this build's pr as its
 * previous). A row that is not the run's own done or error left the run's state and stopped it: finished says
 * stopped, and nothing came out.
 */
export function endRecord(record, spec, row, rows = []) {
  const { event, transition, writes = [], run, seq } = row.payload;
  const value = typeof row.state === 'string' ? JSON.parse(row.state) : row.state; // the journal keeps the state value as JSON
  const finished = { transition, event: event.type, state: value == null ? [] : leaves(value) };
  if (run !== record.run) return { ...record, finished: { ...finished, stopped: true }, wrote: [] };
  const out = (w) => typeof w.from === 'string' && (w.from === 'event.output' || w.from.startsWith('event.output.') || w.from === 'event.error');
  const sets = chart(spec).writes;
  const after = (w) => sets.find((x) => x.set === w.set && x.path === w.path)?.after ?? null;
  const before = contextLog(rows, spec, Number.isInteger(seq) ? seq - 1 : -Infinity);
  // Null when nothing was there: the context default, or a literal null the workflow reset it to (building nulls
  // verdict, so a verdict replaces no earlier verdict).
  const replaced = (path) => {
    const { producer } = producerOf(before, path, spec);
    if (['default', 'none'].includes(producer.kind)) return null;
    if (producer.kind === 'literal' && !producer.part && pointer(spec, producer.at) == null) return null;
    return producer;
  };
  const self = (r) => (r.invoke === record.invoke && r.state === record.state ? { ...r, self: true } : r);
  const output = event.output ?? null;
  return {
    ...record,
    finished,
    ...(event.type.startsWith('xstate.error.') ? { error: event.error ?? null } : { output, stamped: stampedIn(output) }),
    wrote: writes.filter(out).map((w) => ({
      path: w.path, from: w.from, at: paramAt(w), into: after(w), replaced: replaced(w.path), readBy: readers(spec, w.path, after(w)).map(self)
    }))
  };
}
