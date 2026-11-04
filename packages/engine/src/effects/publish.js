// Tourney lane E (option B part, research): the publish effect, the run of a workflow's `publish` actor. The host
// publishes the report blob through a publisher ({ publish({ key, report }) -> { url }, find?(key) }), keyed by the
// effect id, and the URL it got back is the output: written by the host, not an agent.
export const publish = ({ publisher }) => ({
  async start(effect) {
    const made = await publisher.publish({ key: effect.id, report: effect.input?.report });
    if (!made?.url) throw new Error('the publisher gave back no url');
    return { ref: made.url, output: { url: made.url } };
  },
  ...(publisher.find && {
    async find(effect) {
      const made = await publisher.find(effect.id);
      return made?.url ? { ref: made.url, output: { url: made.url } } : null;
    }
  })
});
