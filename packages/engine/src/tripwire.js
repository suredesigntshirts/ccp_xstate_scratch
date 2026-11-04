// The tripwire acted on (plan item engine-item-views). derive.js rework appends a `tripwire` row when a PR passes its
// item's round limit (packages/journal/src/derive/rework.js); written into the item's own file, it reaches the item
// as a `tripwire` event on the host's next call, and the workflow decides what it means (quick-fix steps back to
// replanning when the event names the item's PR). Each row is offered once: its id is the event's source.
import { existsSync } from 'node:fs';
import { readFile } from '../../journal/src/index.js';

/** The tripwire rows in the item's file for this item not yet offered, as host inputs. */
export function tripwiresOf(host) {
  if (!existsSync(host.file)) return [];
  return readFile(host.file).rows
    .filter((r) => r.kind === 'tripwire' && (r.payload?.item ?? r.item) === host.item && r.payload?.repo && r.payload?.pr)
    .map((r) => ({
      event: { type: 'tripwire', url: `https://github.com/${r.payload.repo}/pull/${r.payload.pr}`, rounds: r.payload.rounds, limit: r.payload.limit },
      source: { system: 'journal', ref: `tripwire ${r.id}` },
      at: r.at
    }))
    .filter((input) => !host.seen.has(`${input.source.system} ${input.source.ref}`));
}
