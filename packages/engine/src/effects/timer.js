// The timer effects. The host fires a timer itself, from the first wake whose time passes its due time (wake.js), so
// a timer effect only makes sure such a wake comes: it asks the clock for a wake at the due time, keyed by the
// effect id. Cancelling asks the clock to drop it; the host has already forgotten the timer, so a late wake is stale.

/** The timer handler over a clock: wakeAt?({ key, due }) -> { ref }. With no clock, the due time is the outcome. */
export const timer = ({ clock = {} } = {}) => ({
  async start(effect) {
    if (!effect.due || Number.isNaN(Date.parse(effect.due))) throw new Error(`timer ${effect.timer} has no due time`);
    const set = clock.wakeAt ? await clock.wakeAt({ key: effect.id, due: effect.due }) : null;
    return { ref: set?.ref ?? `due ${effect.due}`, due: effect.due };
  },
  // A timer asked for twice wakes the item twice at worst, and the second wake finds it fired: safe to ask again.
  find: async () => null
});

/** The cancel handler over the same clock: drop?({ key }) for the timer's effect id. */
export const cancel = ({ clock = {} } = {}) => ({
  async start(effect) {
    if (clock.drop) await clock.drop({ key: effect.id.replace(/:cancel$/, '') });
    return {};
  },
  find: async () => null
});
