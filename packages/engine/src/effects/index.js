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

export { github, GitHubError } from './github.js';
export { prRef } from './merge.js';
export { relay, recordCard, cardFile } from './relay.js';

/**
 * Handlers for runEffects: { run, timer, cancel }. `github` is a client from github.js; `hearth` ({ card, post,
 * find? }) reaches the thread, and without it cards and posts stay pending; `clock` ({ wakeAt?, drop? }) schedules
 * the wake a timer needs. `actors` adds run handlers by actor name. A hearth with ready(effect) (relay.js) holds a
 * card or post until it says the thread side is done.
 */
export function handlers({ github, hearth = null, clock = {}, actors = {} } = {}) {
  const byActor = {
    ...(github && { merge: merge({ github }) }),
    ...(hearth && { ask: card({ hearth }), post: post({ hearth }) }),
    ...actors
  };
  return {
    run: {
      handles: (effect) =>
        effect.actor in byActor && !(hearth?.ready && ['ask', 'post'].includes(effect.actor) && !hearth.ready(effect)),
      start: (effect) => byActor[effect.actor].start(effect),
      find: (effect) => (byActor[effect.actor].find ? byActor[effect.actor].find(effect) : undefined)
    },
    timer: timer({ clock }),
    cancel: cancel({ clock })
  };
}
