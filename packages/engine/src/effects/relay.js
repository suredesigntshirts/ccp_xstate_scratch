// The thread as a command-line host reaches it (plan item engine-toy-run). A host process can't call the thread's
// tools, so the session that has them posts the card the host asks for (`bin/host.js show` lists the ask run under
// pending) and records the card's id with `bin/host.js card`. The host's card effect waits until that record exists,
// then finishes with the card's id as its ref, and the tap wake naming that id is the answer (wake.js). Nothing here
// answers a card: a record only says which card was put up, and the platform's tap wake is what moves the item.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

/** Where the record of an ask run's posted card lives: beside the item's runs, under cards/. */
export function cardFile(root, effectId) {
  const m = String(effectId ?? '').match(/^(.+):(\d+\.[\w-]+)$/);
  if (!m) throw new Error(`${effectId} is not a run id`);
  return join(root, 'items', safe(m[1]), 'cards', `${safe(m[2])}.json`);
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * A hearth client for effects/index.js over the posted-card records: ready(effect) says whether the card was put up,
 * card() and find() read its id. Posts have no record, so a post effect stays pending.
 */
export function relay({ root }) {
  const posted = (key) => {
    const record = readJson(cardFile(root, key));
    return record?.ref ? { ref: record.ref } : null;
  };
  return {
    ready: (effect) => effect.actor === 'ask' && existsSync(cardFile(root, effect.id)),
    card: async ({ key }) => posted(key),
    find: async (key) => posted(key)
  };
}

/**
 * Record that the card for an item's open ask run was put up as `ref`. Refused (throws) when the run is not an open
 * ask run of this item, or a record for it already exists: a card is put up once.
 */
export function recordCard({ host, effect: effectId, ref, at = new Date().toISOString() }) {
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('the card needs its id (--ref)');
  const run = host.runs.get(effectId);
  if (!run || run.actor !== 'ask') throw new Error(`${effectId} is not an open ask run of ${host.item}`);
  const file = cardFile(host.root, effectId);
  if (existsSync(file)) throw new Error(`a card for ${effectId} is already recorded`);
  const record = { effect: effectId, ref: ref.trim(), question: run.input?.question ?? null, choices: run.input?.choices ?? null, at };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.${process.pid}`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${file}.${process.pid}`, file);
  return record;
}
