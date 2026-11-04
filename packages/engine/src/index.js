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
