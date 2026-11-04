// Makes rows.jsonl, the observe page's test journal (plan item obs-page), from recorded inputs only. Usage:
//   node plugins/harness/pages/observe/test/fixtures/make.mjs
// Three real sessions, each at its real time, through the real capture code (README.md beside this file says where
// each input was recorded). Row ids are fixed so the file is the same on every run.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, personOf, posted } from '../../../../scripts/capture-rows.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..', '..');
const text = (p) => readFileSync(join(REPO, p), 'utf8');
const jsonl = (p) => text(p).trim().split('\n').map((l) => JSON.parse(l));
const row = (session, at, n, r) => ({ v: 1, id: `observe-fixture-${n}`, at, session, item: null, state: null, release: '0.1.0', ...r });

// 1. A headless session with a subagent, as its own capture wrote it (obs-time-and-rework's fixture).
const real = jsonl('packages/journal/test/fixtures/derive/session.jsonl');

// 2. The wf-quick-fix thread: the card it posted at 16:29:24Z, the person's tap on it and their message after.
const THREAD_SESSION = 'session_01KfkB5HZRbfGRGcZb4ar2mX';
const ATT = 'plugins/harness/test/fixtures/attention';
const THREAD = personOf(text(`${ATT}/tap-wake.txt`)).thread;
const [card] = posted(JSON.parse(text(`${ATT}/card-input.json`)), { thread: THREAD });
const [tap] = personOf(text(`${ATT}/tap-wake.txt`)).rows;
const [message] = personOf(text(`${ATT}/message-wake.txt`)).rows;
const thread = [
  row(THREAD_SESSION, '2026-10-30T16:29:24.000Z', 1, card),
  row(THREAD_SESSION, `${tap.payload.sentAt.slice(0, 19)}.000Z`, 2, tap),
  row(THREAD_SESSION, `${message.payload.sentAt.slice(0, 19)}.000Z`, 3, message),
];

// 3. The probe session the auto mode classifier refused at 11:34:29Z ([Self-Modification]).
const [probe] = jsonl('probes/platform/fixtures/refusals/2026-10-30-self-modification-live-mod-and-hook.jsonl');
const { rows: [refusal] } = capture(probe.input, { newId: () => 'observe-fixture-4' });
const refused = [row(probe.input.session_id, `${probe.at.slice(0, 23)}Z`, 4, refusal)];

const all = [...refused, ...thread, ...real];
writeFileSync(join(HERE, 'rows.jsonl'), all.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${all.length} rows`);
