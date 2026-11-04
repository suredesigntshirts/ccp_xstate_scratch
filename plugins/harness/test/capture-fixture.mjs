// The recorded session capture's tests replay (plan item obs-live-capture): fixtures/capture/, made by its make.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { read } from '../scripts/capture-rows.mjs';

export const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'capture');

/** The fixture's hook inputs in order, with <fixture> in their paths pointed at `dir`. */
export const events = (dir = FIXTURE) =>
  readFileSync(join(FIXTURE, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l.replaceAll('<fixture>', dir)));

/** The rows capture must make from the fixture, without the fields append() stamps. */
export const expected = () => JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'));

/** capture's reader, with <fixture> paths pointed at `dir`. */
export const reader = (dir = FIXTURE) => (path, opts) => read(path.replaceAll('<fixture>', dir), opts);
