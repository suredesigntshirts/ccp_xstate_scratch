#!/usr/bin/env node
// Makes this fixture from a recorded session (plan item obs-live-capture): a hooks log, one JSON line per hook call
// as { input } (every hook event, so "none extra" is tested against events capture ignores), and the session's
// transcript folder. It keeps only the transcript lines capture reads (user and assistant messages, without the
// working folder, environment or account fields) and rewrites paths to <fixture>, so nothing private is checked in.
// Usage: node make.mjs <hooks log> <transcript.jsonl>
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [log, transcript] = process.argv.slice(2);
const sub = join(transcript.replace(/\.jsonl$/, ''), 'subagents');
const KEEP = ['type', 'uuid', 'parentUuid', 'isSidechain', 'agentId', 'timestamp', 'requestId', 'message'];
const jsonl = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const clean = (path) => jsonl(path)
  .filter((e) => e.type === 'user' || e.type === 'assistant')
  .map((e) => Object.fromEntries(KEEP.filter((k) => k in e).map((k) => [k, e[k]])))
  .map((e) => JSON.stringify(e)).join('\n') + '\n';

mkdirSync(join(here, 'session', 'subagents'), { recursive: true });
writeFileSync(join(here, 'session.jsonl'), clean(transcript));
for (const name of readdirSync(sub)) {
  if (name.endsWith('.jsonl')) writeFileSync(join(here, 'session', 'subagents', name), clean(join(sub, name)));
  if (name.endsWith('.meta.json')) copyFileSync(join(sub, name), join(here, 'session', 'subagents', name));
}
const KEEP_INPUT = ['transcript_path', 'agent_transcript_path'];
const DROP_INPUT = ['cwd', 'scratchpad_dir', 'effort'];
const events = jsonl(log).map(({ input }) => {
  for (const k of DROP_INPUT) delete input[k];
  for (const k of KEEP_INPUT) {
    if (input[k]) input[k] = input[k].replace(dirname(transcript), '<fixture>').replace(basename(transcript, '.jsonl'), 'session');
  }
  return JSON.stringify(input);
});
writeFileSync(join(here, 'events.jsonl'), `${events.join('\n')}\n`);
console.log(`fixture: ${events.length} hook calls`);
