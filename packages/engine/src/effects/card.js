// The card effect: the run of a workflow's `ask` actor. It puts the question in front of the person as a decision
// card, keyed by the effect id, and records the card's id as the run's ref. The answer is not the card's to give: it
// arrives as a tap wake, which wake.js matches to this run by that ref.

/**
 * The card handler over a hearth client: card({ key, question, choices, inputs }) -> { ref }, find?(key) -> { ref } or
 * null. inputs are the ask's other inputs (quick-fix's pr, verdict and the builder's notes), what the person reads
 * beside the question; a null or absent one is left out.
 */
export const card = ({ hearth }) => ({
  async start(effect) {
    const { question, choices, ...rest } = effect.input ?? {};
    if (typeof question !== 'string' || !question) throw new Error('the card has no question');
    if (!Array.isArray(choices) || choices.length < 2) throw new Error('the card needs at least two choices');
    const inputs = Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null));
    const made = await hearth.card({ key: effect.id, question, choices, inputs });
    if (!made?.ref) throw new Error('the card was not made: no card id came back');
    return { ref: made.ref, choices };
  },
  ...(hearth.find && {
    async find(effect) {
      const made = await hearth.find(effect.id);
      return made?.ref ? { ref: made.ref, choices: effect.input?.choices ?? null } : null;
    }
  })
});
