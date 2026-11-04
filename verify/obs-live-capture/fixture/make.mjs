// Strips a recorded headless session to what capture reads (verify/obs-live-capture). Usage:
// node make.mjs <hooks.log> <session.jsonl>   (hooks.log: one {t,input} line per hook call, from a tee hook)
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const [log, transcript] = process.argv.slice(2);
const sub = join(transcript.replace(/\.jsonl$/, ''), 'subagents');
const KEEP = ['type', 'uuid', 'parentUuid', 'isSidechain', 'agentId', 'timestamp', 'requestId', 'message'];
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const clean = (p) => jsonl(p).filter((e) => e.type === 'user' || e.type === 'assistant')
  .map((e) => JSON.stringify(Object.fromEntries(KEEP.filter((k) => k in e).map((k) => [k, e[k]])))).join('\n') + '\n';
mkdirSync(join(here, 'session', 'subagents'), { recursive: true });
writeFileSync(join(here, 'session.jsonl'), clean(transcript));
for (const n of readdirSync(sub)) {
  if (n.endsWith('.jsonl')) writeFileSync(join(here, 'session', 'subagents', n), clean(join(sub, n)));
  if (n.endsWith('.meta.json')) copyFileSync(join(sub, n), join(here, 'session', 'subagents', n));
}
const events = jsonl(log).map(({ input }) => {
  for (const k of ['cwd', 'scratchpad_dir', 'effort']) delete input[k];
  for (const k of ['transcript_path', 'agent_transcript_path']) {
    if (input[k]) input[k] = input[k].replace(dirname(transcript), '<fixture>').replace(basename(transcript, '.jsonl'), 'session');
  }
  return JSON.stringify(input);
});
writeFileSync(join(here, 'events.jsonl'), events.join('\n') + '\n');
// Then (by hand): sed the working-folder paths in the outputs to /work, so no machine path is checked in.
