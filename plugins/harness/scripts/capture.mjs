#!/usr/bin/env node
// Capture's hook (plan item obs-live-capture), registered in hooks/hooks.json on every event capture-rows.mjs handles. In a
// project that installed the harness, it appends the rows for one hook input to this session's journal file, stores
// any brief or answer under <journal>/blobs/<sha256> once, then appends a hook.run row with its own time.
// Like every hook here it does nothing elsewhere, prints nothing, swallows every failure and always exits 0. Its
// watchdog ends it within 3 s, inside the hook's 5 s timeout, after journalling hook.run with timedOut true.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gate, journal, journalDir, pluginRoot, release, sessionFile, sessionName, stdin } from './host.mjs';
import { EVENTS, capture, handedBack, read } from './capture-rows.mjs';

const WATCHDOG_MS = 3000;

/** This session's capture state (where the last Stop stopped reading the transcript): never under the plugin root. */
const statePath = (session, env = process.env) =>
  join(env.CCP_HARNESS_STATE || join(tmpdir(), 'ccp-harness'), `capture-${sessionFile(session)}`.replace(/\.jsonl$/, '.json'));

// This session's refusals so far, one { hash, id } line each (plan item obs-refusal-log), so a later call of the same
// action links back by retryOf. Lines are only ever appended, so the async tool-call hooks can read it while
// PermissionDenied or Stop adds to it.
const refusedPath = (session, env = process.env) =>
  join(env.CCP_HARNESS_STATE || join(tmpdir(), 'ccp-harness'), `refusals-${sessionFile(session)}`);
const REFUSAL_AWARE = ['PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'SubagentStop', 'Stop'];

function loadRefused(path) {
  const refused = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      try {
        const { hash, id } = JSON.parse(line);
        if (hash && id) refused[hash] = id;
      } catch {}
    }
  } catch {}
  return refused;
}

function noteRefused(path, rows) {
  const lines = rows.filter((r) => r.kind === 'refusal').map((r) => `${JSON.stringify({ hash: r.payload.actionHash, id: r.id })}\n`);
  if (!lines.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, lines.join(''));
}

function loadState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.${process.pid}`, JSON.stringify(state));
  renameSync(`${path}.${process.pid}`, path);
}

/** Stores a blob once: the first writer of a hash wins and later ones change nothing. */
function store(dir, { hash, text }) {
  const path = join(dir, hash);
  try {
    writeFileSync(path, text, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      mkdirSync(dir, { recursive: true });
      return store(dir, { hash, text });
    }
    if (error.code !== 'EEXIST') throw error;
  }
}

// Claude Code can still be writing a subagent's last lines when SubagentStop runs (seen 2026-10-30: the hand-back
// line landed 20 ms after the hook read the file). This waits until the file ends with the hand-back's result, or,
// for an agent that never hands back, until it has stopped growing for `quiet` ms.
const TAIL = 64 * 1024;
async function settle(path, { quiet = 150, max = 2000 } = {}) {
  const done = () => handedBack(read(path, { from: null, cap: TAIL })?.text ?? '');
  const size = () => {
    try {
      return statSync(path).size;
    } catch {
      return -1;
    }
  };
  const until = Date.now() + max;
  let last = size();
  let since = Date.now();
  while (!done() && Date.now() < until && Date.now() - since < quiet) {
    await new Promise((ok) => setTimeout(ok, 25));
    const now = size();
    if (now !== last) [last, since] = [now, Date.now()];
  }
}

let done = null; // journals hook.run once the session file and base are known
const exit = () => process.exit(0);
setTimeout(() => {
  try {
    done?.(true);
  } catch {}
  exit();
}, WATCHDOG_MS).unref();

try {
  if ((await gate(process.env, 500)) !== 'installed') exit();
  const input = JSON.parse((await stdin(500)) || '{}');
  if (!EVENTS.includes(input.hook_event_name)) exit();
  const root = pluginRoot();
  const session = sessionName(input);
  const path = join(journalDir(), 'sessions', sessionFile(session));
  const base = { session, item: null, state: null, release: release(root).version };
  const { append } = await journal(root);
  const event = input.hook_event_name;
  done = (timedOut) => {
    done = null;
    append(path, {
      ...base,
      agent: input.agent_id ?? null,
      kind: 'hook.run',
      source: { system: 'hook', ref: `${event} ${input.tool_use_id ?? input.agent_id ?? input.prompt_id ?? input.session_id ?? ''}`.trim() },
      payload: { name: `capture ${event}`, ms: Math.round(performance.now()), timedOut },
    });
  };
  if (event === 'SubagentStop' && input.agent_transcript_path) await settle(input.agent_transcript_path);
  const where = statePath(session);
  // Stop keeps where it stopped reading the transcript; UserPromptSubmit keeps the thread the session was woken in,
  // which a hearthbot call's card.posted row reads (capture-rows.mjs, personOf and posted).
  const usesState = event === 'Stop' || event === 'UserPromptSubmit';
  const before = usesState || event === 'PostToolUse' ? loadState(where) : {};
  const refusals = refusedPath(session);
  const refused = REFUSAL_AWARE.includes(event) ? loadRefused(refusals) : {};
  // An invoked actor's agent is bound to its run by the actor hook (actors.mjs), in <journal>/actors/agents/; its rows
  // carry the run's item and state (plan item engine-item-views).
  const bound = new Map();
  const boundOf = (agentId) => {
    if (!agentId) return null;
    if (!bound.has(agentId)) {
      let b = null;
      try {
        b = JSON.parse(readFileSync(join(journalDir(), 'actors', 'agents', `${String(agentId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`), 'utf8'));
      } catch {}
      bound.set(agentId, b);
    }
    return bound.get(agentId);
  };
  const actor = (agentId) => boundOf(agentId) !== null;
  const { rows, blobs, state } = capture(input, { read, state: before, refused, actor });
  for (const b of blobs) store(join(journalDir(), 'blobs'), b);
  for (const row of rows) {
    const b = boundOf(row.agent);
    append(path, { ...base, ...(b?.item ? { item: b.item, state: b.state ?? null } : {}), ...row });
  }
  noteRefused(refusals, rows);
  if (usesState && state !== before) saveState(where, state);
  done(false);
} catch {}
exit();
