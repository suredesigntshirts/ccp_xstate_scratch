// Tourney lane E (option A): the host's own observations of GitHub, offered to an item as events. Every field a guard
// reads about CI or the PR's head comes from here, written by the host from what GitHub
// shows now, never from an agent's word. A workflow takes only the kinds its meta.events declares, so the observer
// offers only those. The host calls observe() on every wake for the item (option A: re-read the head on each wake).
//
//   pr.head.observed  { observed: { head, merged } }   the PR's head moved, or the PR was merged (by anyone)
//   ci.observed       { observed: { sha, conclusion, touchesCi, failing, url } }
//                     the aggregate of the spec's required checks (meta.ci.required) at the PR's head:
//                     success | failure | pending; touchesCi when the PR's diff touches meta.ci.paths
// Round 2 removed expect.observed: the Expect lines an item is graded on are its start input, and nothing the host
// reads from GitHub writes them, so an edit on GitHub never reaches grading.
import { createHash } from 'node:crypto';
import { prRef } from './effects/merge.js';

const sha16 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const RED = ['failure', 'timed_out', 'cancelled', 'action_required'];

/** The required checks at a commit, as one conclusion: failure if any is red, success if all are green, else pending. */
export function aggregate(checkRuns, required) {
  const latest = new Map();
  for (const run of checkRuns ?? []) latest.set(run.name, run);
  const failing = required.filter((name) => RED.includes(latest.get(name)?.conclusion));
  if (failing.length) return { conclusion: 'failure', failing: failing.join(','), url: latest.get(failing[0])?.html_url ?? null };
  if (required.every((name) => latest.get(name)?.conclusion === 'success')) return { conclusion: 'success', failing: null, url: null };
  return { conclusion: 'pending', failing: null, url: null };
}

/** The events GitHub's present state offers the item, as host inputs. */
export async function observe(host, github) {
  const inputs = [];
  if (!host.snapshot || host.snapshot.status !== 'active') return inputs;
  const takes = host.spec.meta.events ?? {};
  const c = host.snapshot.context;
  const ci = host.spec.meta.ci ?? {};
  const add = (type, observed) => {
    if (!takes[type]) return;
    inputs.push({ event: { type, observed }, source: { system: 'host', ref: `observe ${type} ${sha16(JSON.stringify(observed))} @${host.seq}` } });
  };

  const ref = prRef(c.pr?.url);
  if (ref && c.pr?.headSha) {
    const pull = await github.pull(ref);
    const head = pull?.head?.sha;
    if (pull?.merged && !c.merge?.sha) add('pr.head.observed', { head, merged: true });
    else if (head && head !== c.pr.headSha) add('pr.head.observed', { head, merged: false });
    else if (head && takes['ci.observed']) {
      const { check_runs: runs } = await github.checks({ owner: ref.owner, repo: ref.repo, sha: head });
      const { conclusion, failing, url } = aggregate(runs, ci.required ?? []);
      const files = await github.files(ref);
      const paths = ci.paths ?? ['.github/'];
      const touchesCi = (files ?? []).some((f) => paths.some((p) => String(f.filename).startsWith(p)));
      const now = c.ci;
      if (!(now?.sha === head && now?.conclusion === conclusion && now?.touchesCi === touchesCi)) {
        add('ci.observed', { sha: head, conclusion, touchesCi, failing, url });
      }
    }
  }

  return inputs;
}
