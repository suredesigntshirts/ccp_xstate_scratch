// The merge effect: the run of a workflow's `merge` actor. It merges the PR at the verified commit exactly, through
// the GitHub merge tool's REST call with expectedHeadSha, so a commit pushed after the verdict makes GitHub refuse
// the merge and the PR stays open (ledger L-merge-at-verified-head). It is the only way the host merges, and its
// engine.effect row is what the journal check takes as a merge the host made (case C-merge-outside-host-detected).

/** owner, repo and number from a PR's URL, https://github.com/<owner>/<repo>/pull/<n>; null when it isn't one. */
export const prRef = (url) => {
  const m = String(url ?? '').match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/);
  return m ? { owner: m[1], repo: m[2], pullNumber: Number(m[3]) } : null;
};

const SHA = /^[0-9a-f]{40}$/;

// What the effect ended with: the merge's sha is the actor's output ({ sha }, quick-fix's meta.actors.merge).
const merged = (ref, head, sha) => ({
  ref: `${ref.owner}/${ref.repo}#${ref.pullNumber}`,
  repo: `${ref.owner}/${ref.repo}`,
  number: ref.pullNumber,
  head,
  sha,
  output: { sha }
});

// The effect's input as GitHub needs it, or an error naming what is missing.
function target(effect) {
  const ref = prRef(effect.input?.pr?.url);
  if (!ref) throw new Error(`the merge has no PR URL to merge (input.pr.url is ${JSON.stringify(effect.input?.pr?.url ?? null)})`);
  const sha = effect.input?.sha;
  if (!SHA.test(String(sha))) throw new Error(`the merge has no verified sha (input.sha is ${JSON.stringify(sha ?? null)})`);
  return { ref, sha };
}

/** The merge handler over a GitHub client ({ pull, merge }, effects/github.js). */
export const merge = ({ github }) => ({
  async start(effect) {
    const { ref, sha } = target(effect);
    try {
      const done = await github.merge({ ...ref, expectedHeadSha: sha, merge_method: 'merge' });
      return merged(ref, sha, done.sha);
    } catch (error) {
      if (!error.status) throw error;
      // Name what GitHub has now, so the item's failure says why: most often a push after the verdict.
      const now = await github.pull(ref).catch(() => null);
      const head = now?.head?.sha ?? 'unknown';
      throw new Error(`GitHub refused the merge of ${ref.owner}/${ref.repo}#${ref.pullNumber} at ${sha}: ${error.github} (the PR's head is ${head})`);
    }
  },
  // After a crash mid-merge: GitHub says whether it merged, and at which head. Not merged means it never happened.
  async find(effect) {
    const { ref, sha } = target(effect);
    const now = await github.pull(ref);
    if (!now.merged) return null;
    if (now.head?.sha !== sha) throw new Error(`${ref.owner}/${ref.repo}#${ref.pullNumber} was merged at ${now.head?.sha}, not ${sha}`);
    return merged(ref, sha, now.merge_commit_sha);
  }
});
