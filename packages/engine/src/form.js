// The workflow's form (stage-contract cleanup round 5): which keys of the XState config the harness reads, and where
// an action may sit. A workflow is plain XState JSON, but the harness takes only a part of XState: states with on,
// after and invoke; transitions with target, guard and actions; and one action, set. XState itself would also run
// actions on entry, exit and always, on the root, or on onSnapshot. The chart walk (stages.js chart), the wiring and
// coverage checks (shapes, decisions) and the stage record (spec.js wrote marks) see only the set actions on the
// transitions of a state's on, after and invoke onDone/onError, so a workflow that writes anywhere else is refused at
// load, naming the key and its JSON pointer. Nothing here imports anything.

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const esc = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

/** The keys the harness reads at the root, on a state, on an invoke and on a transition; anything else is refused. */
export const FORM = Object.freeze({
  root: ['id', 'description', 'initial', 'context', 'output', 'states', 'meta'],
  state: ['type', 'description', 'initial', 'states', 'on', 'after', 'invoke', 'meta'],
  invoke: ['id', 'src', 'input', 'onDone', 'onError'],
  transition: ['target', 'guard', 'actions', 'description']
});

/**
 * The spec, or a throw naming the first key outside FORM or the first action that is not a set. See the head of this file
 * for why.
 */
export function checkForm(spec) {
  const refuse = (at, what) => { throw new Error(`${spec.id}: ${what} (at ${at || '/'}). The harness runs a set action only on a transition (a state's on, after, or invoke onDone/onError), where the chart, the load checks and the stage record see it: move it there`); };
  const keys = (node, allowed, at, what) => {
    if (!isObject(node)) refuse(at, `${what} is not an object`);
    for (const k of Object.keys(node)) if (!allowed.includes(k)) refuse(`${at}/${esc(k)}`, `${what} has ${k}, which the harness does not read`);
  };
  const transitions = (ts, at) => {
    const many = Array.isArray(ts);
    [ts].flat().forEach((t, i) => {
      const tat = many ? `${at}/${i}` : at;
      if (typeof t === 'string') return;
      keys(t, FORM.transition, tat, 'transition');
      if (t.guard != null && typeof t.guard !== 'string') refuse(`${tat}/guard`, 'a guard is a name in meta.guards');
      if (t.actions == null) return;
      const list = Array.isArray(t.actions);
      [t.actions].flat().forEach((a, j) => {
        const aat = list ? `${tat}/actions/${j}` : `${tat}/actions`;
        if (!isObject(a) || a.type !== 'set' || !isObject(a.params) || Object.keys(a).some((k) => k !== 'type' && k !== 'params')) refuse(aat, `action ${JSON.stringify(a)} is not { type: "set", params }, the only action`);
      });
    });
  };
  const state = (st, at, allowed, what) => {
    keys(st, allowed, at, what);
    if (st.initial != null && typeof st.initial !== 'string') refuse(`${at}/initial`, `${what}'s initial is not a state name`);
    for (const [ev, ts] of Object.entries(st.on ?? {})) transitions(ts, `${at}/on/${esc(ev)}`);
    for (const [d, ts] of Object.entries(st.after ?? {})) transitions(ts, `${at}/after/${esc(d)}`);
    const list = st.invoke == null ? [] : Array.isArray(st.invoke) ? st.invoke.map((v, i) => [v, `${at}/invoke/${i}`]) : [[st.invoke, `${at}/invoke`]];
    for (const [inv, iat] of list) {
      keys(inv, FORM.invoke, iat, 'invoke');
      if (inv.onDone != null) transitions(inv.onDone, `${iat}/onDone`);
      if (inv.onError != null) transitions(inv.onError, `${iat}/onError`);
    }
    for (const [name, child] of Object.entries(st.states ?? {})) state(child, `${at}/states/${esc(name)}`, FORM.state, `state ${name}`);
  };
  state(spec, '', FORM.root, 'the workflow');
  return spec;
}
