// The engine: a workflow file loaded into XState. Ported from ccp_machine PR #110 (packages/orchestrator).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFile } from '../../journal/src/index.js';
import { stageProblems } from './stage.js';
import { EFFECTS } from './effects/index.js';

export { machineOf, failing, get, mapPaths, startRefusal, hashOf, replay } from './spec.js';
export { check } from './schema.js';
export { restore, applyEvent, persist, runEffects, offer, pending, itemFile, sessionFile, OwnedError } from './host.js';
export { wakesIn, inputsOfWake, dueTimers } from './wake.js';
export { actors, accept, deliver, resultsOf, waiting } from './actors.js';
export { tripwiresOf } from './tripwire.js';
export { render, returnPart, stageProblems } from './stage.js';

const REPO_WORKFLOWS = new URL('../../../workflows/', import.meta.url).pathname;
const PINNED = /^(.+)@([0-9a-f]{64})$/;

// The stage contract (tournament 2026-11-04, lane M): a workflow whose model stages miss a part refuses to load. The
// folder is read only to know which invoke srcs start a child item, as the item handler does when it starts one; a
// stage that shares a workflow's name is still the stage (effects/index.js handlers), so a new workflow file never
// changes how a pinned workflow loads or runs.
function checked(name, text, dir) {
  const spec = JSON.parse(text);
  let workflows = [];
  try {
    workflows = readdirSync(dir ?? REPO_WORKFLOWS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {}
  const problems = stageProblems(spec, { effects: EFFECTS, workflows });
  if (problems.length) throw new Error(`workflow ${name} refuses to load: ${problems.join('; ')}`);
  return spec;
}

/**
 * A workflow by name (design A, 4.3: the pin). `name@<sha256>` reads the pinned bytes from <root>/blobs and checks
 * their hash. A plain name reads <dir ?? repo workflows>/<name>.json, stores its bytes as a blob under root (when
 * given), and returns the spec with id `<name>@<sha256>`, so every row the item writes names the bytes it runs on.
 */
export const loadWorkflow = (name, { root = null, dir = null } = {}) => {
  const pinned = String(name).match(PINNED);
  if (pinned) {
    if (!root) throw new Error(`${name} is pinned, and no root was given to read its blob from`);
    const bytes = readFileSync(join(root, 'blobs', pinned[2]));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== pinned[2]) throw new Error(`blob ${pinned[2]} hashes to ${hash}`);
    return { ...checked(name, bytes.toString('utf8'), dir), id: name };
  }
  const bytes = readFileSync(join(dir ?? REPO_WORKFLOWS, `${name}.json`));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const spec = checked(name, bytes.toString('utf8'), dir);
  if (root) {
    const path = join(root, 'blobs', hash);
    if (!existsSync(path)) {
      mkdirSync(join(root, 'blobs'), { recursive: true });
      writeFileSync(path, bytes);
    }
  }
  return { ...spec, id: `${name}@${hash}` };
};

/** The pinned workflow an item started on (its seq-0 row's payload.workflow), or null when it has not started. */
export const workflowOf = (root, item) => {
  let rows;
  try {
    rows = readFile(join(root, 'items', `${item}.jsonl`)).rows;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const first = rows.find((r) => r.kind === 'engine.transition' && r.payload.outcome === 'applied' && r.payload.seq === 0);
  return first ? loadWorkflow(first.payload.workflow, { root }) : null;
};
