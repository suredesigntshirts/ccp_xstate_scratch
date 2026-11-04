// The engine: a workflow file loaded into XState. Ported from ccp_machine PR #110 (packages/orchestrator).
import { readFileSync } from 'node:fs';

export { machineOf, failing, get, mapPaths, startRefusal, hashOf, replay } from './spec.js';
export { check } from './schema.js';
export { restore, applyEvent, persist, runEffects, offer, pending, itemFile, sessionFile, OwnedError } from './host.js';
export { wakesIn, inputsOfWake, dueTimers } from './wake.js';
export { actors, accept, deliver, resultsOf, waiting } from './actors.js';
export { tripwiresOf } from './tripwire.js';

/** A workflow file from the repo's workflows/ folder, by name, such as 'quick-fix'. */
export const loadWorkflow = (name) =>
  JSON.parse(readFileSync(new URL(`../../../workflows/${name}.json`, import.meta.url), 'utf8'));

// ---- The load-time pin (design C): a workflow loads as <name>@<sha256 of its file>, its bytes in blobs/, and an
// item restores from the digest its first journal row names, never from the file on disk.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile as readJournal } from '../../journal/src/index.js';
import { restore as restoreItem, itemFile as itemFileOf } from './host.js';

const WORKFLOWS = fileURLToPath(new URL('../../../workflows/', import.meta.url));
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Read workflows/<name>.json, store its bytes in blobs/<d>, and return the spec with id `<name>@<d>`. */
export function pinWorkflow(root, name, dir = WORKFLOWS) {
  const bytes = readFileSync(join(dir, `${name}.json`));
  const d = digestOf(bytes);
  const blob = join(root, 'blobs', d);
  if (!existsSync(blob)) {
    mkdirSync(join(root, 'blobs'), { recursive: true });
    writeFileSync(blob, bytes);
  }
  return { ...JSON.parse(bytes.toString('utf8')), id: `${name}@${d}` };
}

/** The spec an item started on: its first transition row names `<name>@<d>`, read from blobs/<d> and checked. */
export function pinnedWorkflow(root, item) {
  const first = readJournal(itemFileOf(root, item)).rows
    .find((r) => r.kind === 'engine.transition' && r.payload?.seq === 0 && r.payload?.outcome === 'applied');
  const id = first?.payload?.workflow;
  const m = String(id ?? '').match(/^(.+)@([0-9a-f]{64})$/);
  if (!m) throw new Error(`${item}'s first row names no pinned workflow (${JSON.stringify(id ?? null)})`);
  const bytes = readFileSync(join(root, 'blobs', m[2]));
  if (digestOf(bytes) !== m[2]) throw new Error(`blobs/${m[2]} does not hash to its name`);
  return { ...JSON.parse(bytes.toString('utf8')), id };
}

/** The item's host: on its pinned workflow when it has started, else on the workflow file pinned now. */
export function openItem({ root, item, workflow, session, release, dir = WORKFLOWS }) {
  const started = existsSync(itemFileOf(root, item));
  const spec = started ? pinnedWorkflow(root, item) : pinWorkflow(root, workflow, dir);
  return restoreItem({ root, item, spec, session, release });
}
