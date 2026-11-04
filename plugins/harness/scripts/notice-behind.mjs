#!/usr/bin/env node
// UserPromptSubmit hook (plan item self-update-by-version). A session loads the plugin only when it starts, so a
// long session keeps running its release after a newer one is out. At most once per 30 minutes per session, this
// asks origin for the newest harness-v* tag and, when it is above the release this copy runs, tells the session in
// one line that a new thread loads it. It never updates anything: a session must not edit the plugin it runs
// (ledger L-no-self-modification), and its only write is its own timestamp outside the plugin root.
// Like every hook here it does nothing unless the project installed the harness, swallows every failure, always
// exits 0, and a watchdog ends it within about 3 s.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gate, pluginRoot, release, repoDir, sessionFile, sessionName, stdin } from './host.mjs';
import { byVersion, latestRelease } from './fingerprint.mjs';

const INTERVAL_MS = 30 * 60 * 1000;
const WATCHDOG_MS = 3000;

/** Where this session's last check time is kept: never under the plugin root. */
const statePath = (session, env = process.env) =>
  join(env.CCP_HARNESS_STATE || join(tmpdir(), 'ccp-harness'), `notice-${sessionFile(session)}`.replace(/\.jsonl$/, '.json'));

const say = (text) => {
  if (text) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })}\n`);
  process.exit(0);
};
setTimeout(() => say(null), WATCHDOG_MS).unref();

try {
  if ((await gate(process.env, 500)) !== 'installed') say(null);
  const input = JSON.parse((await stdin(500)) || '{}');
  const path = statePath(sessionName(input));
  let last = 0;
  try {
    last = Date.parse(JSON.parse(readFileSync(path, 'utf8')).checkedAt) || 0;
  } catch {}
  if (Date.now() - last < INTERVAL_MS) say(null);
  // Saved before asking origin, so a slow or killed check is not retried for 30 minutes.
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.${process.pid}`, JSON.stringify({ checkedAt: new Date().toISOString() }));
  renameSync(`${path}.${process.pid}`, path);
  const mine = release(pluginRoot());
  const latest = await latestRelease(repoDir(), 2000);
  if (latest.state !== 'found' || byVersion(mine.version, latest.version) >= 0) say(null);
  say(`ccp-harness: this session runs release ${mine.version}, but ${latest.version} (${latest.tag}) is out. Plugins load only when a session starts, so this session keeps ${mine.version}; finish or hand off the current step, then a new thread runs ${latest.version}.`);
} catch {
  say(null);
}
