// This tournament's measure (plan item tournament-kit): what the 2026-11-03-context pack scores, read from a lane
// checkout by a script rather than counted by a judge. scripts/tournament/measure.mjs calls measure().
//
// Reports, from the lane's workflows/*.json:
//   specLines        pretty-printed JSON lines per workflow, and their total (the pack's measure 3)
//   stateKinds       state `type`s used (normal when unset)
//   transitionKinds  invoke.onDone, invoke.onError, invoke[] (a list of invokes), on, after, always, state.onDone,
//                    machine.on, and reenter (a transition flagged reenter)
//   ops              action types on transitions, entry and exit
//   guardForms       condition forms in meta.guards and inline guards: present for a bare path, else each key but path
//   effects          effect types the chart implies (run and stop from invoke, timer and cancel from after)
//   actors           invoke src names
//   events           event names: meta.events keys and `on` keys
//   metaKeys         machine meta keys and state meta keys
//   stateKeys        every key a state uses, so a format extension shows up even where the tallies above miss it
// and, from git against the tournament's base snapshot:
//   interpreterFilesChanged  packages/engine/src/spec.js and host.js changed (the pack counts these double)
//   engineFilesChanged       every packages/engine/src file changed
// Tallies are { name: count } over all workflows; `distinct` counts the names in each.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const INTERPRETER = ['packages/engine/src/spec.js', 'packages/engine/src/host.js'];

const bump = (t, k, n = 1) => (t[k] = (t[k] || 0) + n);
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function guardForms(cond, t) {
  for (const c of list(cond)) {
    if (typeof c === 'string') bump(t, 'present');
    else if (c && typeof c === 'object') {
      const keys = Object.keys(c).filter((k) => k !== 'path');
      if (keys.length === 0) bump(t, 'present');
      for (const k of keys) {
        if (['and', 'or', 'not', 'all', 'any'].includes(k)) {
          bump(t, k);
          guardForms(c[k], t);
        } else bump(t, k);
      }
    }
  }
}

export function tally(workflows) {
  const m = { stateKinds: {}, transitionKinds: {}, ops: {}, guardForms: {}, effects: {}, actors: {}, events: {}, metaKeys: {}, stateKeys: {} };
  const actions = (acts) => {
    for (const a of list(acts)) bump(m.ops, typeof a === 'string' ? a : a?.type ?? 'unknown');
  };
  const transition = (kind, t) => {
    for (const x of list(t)) {
      bump(m.transitionKinds, kind);
      if (x && typeof x === 'object') {
        if (x.reenter) bump(m.transitionKinds, 'reenter');
        actions(x.actions);
        if (x.guard && typeof x.guard === 'object') guardForms(x.guard, m.guardForms);
      }
    }
  };
  const states = (sts) => {
    for (const s of Object.values(sts || {})) {
      if (!s || typeof s !== 'object') continue;
      for (const k of Object.keys(s)) bump(m.stateKeys, k);
      bump(m.stateKinds, s.type || 'normal');
      for (const k of Object.keys(s.meta || {})) bump(m.metaKeys, `state.${k}`);
      const invokes = list(s.invoke);
      if (Array.isArray(s.invoke)) bump(m.transitionKinds, 'invoke[]');
      for (const inv of invokes) {
        bump(m.effects, 'run');
        bump(m.effects, 'stop');
        if (inv.src) bump(m.actors, inv.src);
        transition('invoke.onDone', inv.onDone);
        transition('invoke.onError', inv.onError);
      }
      for (const [ev, t] of Object.entries(s.on || {})) {
        bump(m.events, ev);
        transition('on', t);
      }
      for (const t of Object.values(s.after || {})) {
        bump(m.effects, 'timer');
        bump(m.effects, 'cancel');
        transition('after', t);
      }
      transition('always', s.always);
      transition('state.onDone', s.onDone);
      actions(s.entry);
      actions(s.exit);
      states(s.states);
    }
  };
  for (const wf of Object.values(workflows)) {
    for (const k of Object.keys(wf.meta || {})) bump(m.metaKeys, k);
    for (const ev of Object.keys(wf.meta?.events || {})) bump(m.events, ev);
    for (const cond of Object.values(wf.meta?.guards || {})) guardForms(cond, m.guardForms);
    for (const [ev, t] of Object.entries(wf.on || {})) {
      bump(m.events, ev);
      transition('machine.on', t);
    }
    states(wf.states);
  }
  m.distinct = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Object.keys(v).length]));
  return m;
}

function changed(checkout, base) {
  const r = spawnSync('git', ['diff', '--name-only', base, 'HEAD', '--', 'packages/engine/src'], { cwd: checkout, encoding: 'utf8' });
  if (r.status !== 0) return { error: `git diff ${base}: ${(r.stderr || '').trim()}` };
  return { files: r.stdout.split('\n').filter(Boolean).sort() };
}

export function measure({ checkout, config }) {
  const dir = path.join(checkout, 'workflows');
  const workflows = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort())
    workflows[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const lines = Object.fromEntries(Object.entries(workflows).map(([k, v]) => [k, JSON.stringify(v, null, 2).split('\n').length]));
  const specLines = { ...lines, total: Object.values(lines).reduce((a, b) => a + b, 0) };
  const engine = changed(checkout, config.base.snapshot.sha);
  return {
    specLines,
    ...tally(workflows),
    interpreterFilesChanged: engine.files ? engine.files.filter((f) => INTERPRETER.includes(f)) : engine,
    engineFilesChanged: engine.files ?? engine
  };
}
