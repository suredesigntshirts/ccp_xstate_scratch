// Helpers for the verifier's gap-case characterisation tests (plan item parity-cases, Expect id gaps-real).
// Real effect handlers (packages/engine/src/effects) over a recording thread and clock; agents are stubs.
import { handlers } from '../../packages/engine/src/effects/index.js';
import { BRIEFS, PR, VERDICT, A } from './lib.mjs';

/** The thread and clock as the host's effects reach them; everything asked for is kept. */
export function thread() {
  const cards = [];
  const wakes = [];
  let n = 0;
  return {
    cards,
    wakes,
    hearth: { card: async ({ key, question, choices }) => { cards.push({ key, question, choices }); return { ref: `cmsg_${++n}` }; }, post: async ({ key, text }) => ({ ref: `cmsg_${++n}` }) },
    clock: { wakeAt: async ({ key, due }) => { wakes.push({ key, due }); return { ref: `wake ${key}` }; } }
  };
}

/** Agent actors that finish at once with the next queued output. */
export const agentActors = ({ brief = [BRIEFS], build = [PR(A)], verify = [VERDICT('PASS', A)] } = {}) => {
  const q = { brief: [...brief], build: [...build], verify: [...verify] };
  return Object.fromEntries(Object.keys(q).map((name) => [name, { start: async (e) => (q[name].length ? { ref: e.id, output: q[name].shift() } : { ref: e.id }) }]));
};

export const realHandlers = ({ plat = thread(), actors = agentActors(), hearth = true } = {}) =>
  handlers({ hearth: hearth ? plat.hearth : null, clock: plat.clock, actors });
