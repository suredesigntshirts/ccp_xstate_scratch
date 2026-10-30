#!/usr/bin/env node
// SessionStart hook. In a project that installed the harness, it journals one session.fingerprint row and one
// session.selfcheck row to <journal>/sessions/<session>.jsonl, then tells the session in one line whether the
// self-check passed, naming each failed check in one plain sentence. Without the marker, or with
// CCP_HARNESS_DISABLED=1, it exits 0 with no output and writes nothing.
// It must never get in the session's way: it swallows every failure, always exits 0, and a watchdog ends it
// within about 4 s, inside the hook's 5 s timeout.
// Its own modules are imported once it runs, so a copy missing one of them still says which file is gone, in any
// project, rather than crash with nothing said (plan item clean-room-install-test).
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WATCHDOG_MS = 4000;

const say = (text) => {
  if (text) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })}\n`);
  }
  process.exit(0);
};

let pending = null; // what to say if the watchdog fires once the gate has said installed
setTimeout(() => say(pending), WATCHDOG_MS).unref();

let host, fp, sc;
try {
  [host, fp, sc] = await Promise.all([import('./host.mjs'), import('./fingerprint.mjs'), import('./selfcheck.mjs')]);
} catch (error) {
  if (process.env.CCP_HARNESS_DISABLED === '1') say(null); // host.mjs owns this switch, but it may be the missing file
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const file = error.message.match(/'([^']+)'/)?.[1];
  const what = error.code === 'ERR_MODULE_NOT_FOUND' && file ? `is missing ${relative(root, file)}` : `could not load its scripts (${error.message})`;
  say(`ccp-harness: self-check FAILED. The plugin at ${root} ${what}, so the session-start self-check could not run; a new thread gets a fresh copy of the release, and if it is missing there too the release itself is broken.`);
}
const { gate, journal, journalDir, pluginRoot, sessionFile, sessionName, stdin } = host;
const { collect, fingerprint } = fp;
const { selfcheck, summary } = sc;

try {
  if ((await gate()) !== 'installed') say(null);
  pending = 'ccp-harness: the session-start self-check ran out of time, so no fingerprint was journalled for this session.';
  const input = JSON.parse((await stdin(500)) || '{}');
  const root = pluginRoot();
  const facts = await collect({ input, root });
  const result = selfcheck(facts);
  const session = sessionName(input);
  const path = join(journalDir(), 'sessions', sessionFile(session));
  const base = { session, agent: null, item: null, state: null, release: facts.plugin.version };
  const ref = input.session_id || session;
  try {
    const { append } = await journal(root);
    append(path, { ...base, kind: 'session.fingerprint', source: { system: 'claude-code', ref }, payload: fingerprint(facts) });
    result.checks.push({ id: 'journal', status: 'pass', detail: `journalling to ${path}` });
    append(path, { ...base, kind: 'session.selfcheck', source: { system: 'hook', ref: `SessionStart ${ref}` }, payload: result });
  } catch (error) {
    result.passed = false;
    result.checks.push({ id: 'journal', status: 'fail', detail: `The journal at ${path} could not be written (${error.message}), so this session's rows are lost.` });
  }
  say(summary(result, facts.plugin));
} catch (error) {
  say(`ccp-harness: the session-start self-check crashed (${error.message}), so nothing was journalled for this session.`);
}

