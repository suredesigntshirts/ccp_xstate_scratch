// The post effect: the run of a workflow's `post` actor. It posts the text in the item's thread, keyed by the effect
// id, and finishes the run with the message's id as its output: a post has nothing to wait for.

/** The post handler over a hearth client: post({ key, text }) -> { ref }, find?(key) -> { ref } or null. */
export const post = ({ hearth }) => ({
  async start(effect) {
    const text = effect.input?.text;
    if (typeof text !== 'string' || !text) throw new Error('the post has no text');
    const sent = await hearth.post({ key: effect.id, text });
    if (!sent?.ref) throw new Error('the post was not sent: no message id came back');
    return { ref: sent.ref, output: { ref: sent.ref } };
  },
  ...(hearth.find && {
    async find(effect) {
      const sent = await hearth.find(effect.id);
      return sent?.ref ? { ref: sent.ref, output: { ref: sent.ref } } : null;
    }
  })
});
