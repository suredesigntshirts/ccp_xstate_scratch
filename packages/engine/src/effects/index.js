// The host's effect handlers (plan item engine-effects): every outside action an item takes is one of these, run by
// the host once per effect id (host.js runEffects). Each takes an effect and returns its outcome. None runs a shell
// command: GitHub is reached over REST (github.js), and the thread and the clock through clients the caller hands in.
//
// A workflow names the action by its actor: merge -> merge.js, ask -> card.js, post -> post.js. Other actors (brief,
// build, verify) are agents, which engine-actors starts; this run handler leaves them for a handler that has them.
import { merge } from './merge.js';
import { card } from './card.js';
import { post } from './post.js';
import { timer, cancel } from './timer.js';
import { item } from './item.js';
import { EFFECTS } from '../stages.js';

// The handler of each host effect, by actor name. stages.js EFFECTS is the one list of these names (the load check lets
// a workflow invoke exactly these besides stages and workflows); this table is keyed by it, and a name without a
// handler fails at import, loudly. Each maker takes handlers()' options and returns null when a client it needs is
// missing.
const MAKERS = {
  merge: ({ github }) => (github ? merge({ github }) : null),
  ask: ({ hearth }) => (hearth ? card({ hearth }) : null),
  post: ({ hearth }) => (hearth ? post({ hearth }) : null)
};
for (const name of EFFECTS) if (!MAKERS[name]) throw new Error(`stages.js EFFECTS lists ${name}, but effects/index.js has no handler for it`);

export { item, childResults, settle, openItems, pump } from './item.js';

export { github, GitHubError } from './github.js';
export { prRef } from './merge.js';
export { relay, recordCard, cardFile } from './relay.js';

/**
 * Handlers for runEffects: { run, timer, cancel }. `github` is a client from github.js; `hearth` ({ card, post,
 * find? }) reaches the thread, and without it cards and posts stay pending; `clock` ({ wakeAt?, drop? }) schedules
 * the wake a timer needs. `actors` adds run handlers by actor name. A hearth with ready(effect) (relay.js) holds a
 * card or post until it says the thread side is done.
 */
export function handlers({ github, hearth = null, clock = {}, actors = {}, host = null, workflows = [], load, handlersFor } = {}) {
  const byActor = {
    ...Object.fromEntries(EFFECTS.map((name) => [name, MAKERS[name]({ github, hearth })]).filter(([, h]) => h)),
    // Design A, 4.2: a workflow name as an actor starts a child item.
    ...(host && handlersFor ? Object.fromEntries(workflows.map((name) => [name, item({ host, load, handlersFor })])) : {}),
    // Model stages last (stage contract, lane S round 2): a stage named like a workflow is still its own agent, never a
    // child item.
    ...actors
  };
  return {
    run: {
      handles: (effect) =>
        effect.actor in byActor && !(hearth?.ready && ['ask', 'post'].includes(effect.actor) && !hearth.ready(effect)),
      start: (effect) => byActor[effect.actor].start(effect),
      find: (effect) => (byActor[effect.actor].find ? byActor[effect.actor].find(effect) : undefined),
      // The run's done or error event was applied (host.js offer): a handler may record where its output went.
      ended: (effect, row) => byActor[effect.actor]?.ended?.(effect, row)
    },
    timer: timer({ clock }),
    cancel: cancel({ clock })
  };
}
