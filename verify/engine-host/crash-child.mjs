// Helper for the restart test: runs a host's effects in a real process that dies (exit 9) in the middle of the effect.
import { appendFileSync } from 'node:fs';
import { restore, offer } from '../../packages/engine/src/index.js';
const [root, specFile, sideEffectLog] = process.argv.slice(2);
const spec = JSON.parse((await import('node:fs')).readFileSync(specFile, 'utf8'));
const host = restore({ root, item: 'v-1', spec, session: 'S-owner', release: '0.2.0' });
const handlers = { run: { start: async () => { appendFileSync(sideEffectLog, 'MERGED\n'); process.exit(9); } } };
await offer(host, [], handlers);
