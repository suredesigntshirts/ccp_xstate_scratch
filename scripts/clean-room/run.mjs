#!/usr/bin/env node
// The clean-room install test (plan item clean-room-install-test). In a new temp folder it makes an empty HOME and
// an empty project folder, runs the setup script into that HOME, installs the harness in that project, starts one
// session there, and passes only when the plugin's self-check passed and the journal holds its two rows.
// The session is a headless `claude -p` when there is a model to answer it, else the plugin's SessionStart hooks
// run as Claude Code runs them, with no model (plan/decisions/2026-10-30-clean-room-hooks-without-model.md).
//
//   node scripts/clean-room/run.mjs [--repo <clone>] [--ref <ref>] [--session auto|claude|hooks] [--keep]
//
// --repo is the clone whose setup script runs (default this one). --ref installs that ref, as a PR run does with
// HEAD; without it the setup script fetches and installs the newest release, as a container build does.
// --session auto (the default) starts claude -p when ANTHROPIC_API_KEY is set. Nothing outside the temp folder is
// written, except what the setup script fetches into the clone. Prints a report; with GITHUB_STEP_SUMMARY set it
// also writes it there. Exits 0 when the clean room passed, 1 when not.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = 'ccp-harness';
const SESSION_TIMEOUT_MS = 180_000;

function args(argv) {
  const out = { repo: resolve(HERE, '..', '..'), ref: null, session: 'auto', keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = resolve(argv[++i]);
    else if (a === '--ref') out.ref = argv[++i];
    else if (a === '--session') out.session = argv[++i];
    else if (a === '--keep') out.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!['auto', 'claude', 'hooks'].includes(out.session)) throw new Error(`--session must be auto, claude or hooks, not ${out.session}`);
  return out;
}

/** The session's context line from a SessionStart hook's stdout: its additionalContext, else the raw text. */
export function contextLine(stdout) {
  try {
    return JSON.parse(stdout).hookSpecificOutput.additionalContext;
  } catch {
    return String(stdout ?? '').trim();
  }
}

/**
 * The ccp-harness SessionStart hook's response in a `claude -p --output-format stream-json --verbose` transcript:
 * { ran: number of SessionStart hooks Claude Code started, hook: the response whose output is ccp-harness's, or null }.
 */
export function harnessHook(transcript) {
  let ran = 0, hook = null;
  for (const line of transcript.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'system' || event.hook_event !== 'SessionStart') continue;
    if (event.subtype === 'hook_started') ran++;
    const said = `${event.output ?? ''}${event.stdout ?? ''}${event.stderr ?? ''}`;
    if (event.subtype === 'hook_response' && /ccp-harness/.test(said)) hook = event;
  }
  return { ran, hook };
}

/** Runs the clean room. Returns { passed, mode, line, steps: [{ step, ok, detail }], room }. */
export function cleanRoom({ repo, ref = null, session = 'auto', env = process.env } = {}) {
  const room = mkdtempSync(join(tmpdir(), 'ccp-clean-room-'));
  const home = join(room, 'home'), project = join(room, 'project');
  mkdirSync(home);
  mkdirSync(project);
  const steps = [];
  const step = (name, ok, detail) => (steps.push({ step: name, ok, detail }), ok);
  const done = (mode, line) => ({ passed: steps.every((s) => s.ok), mode, line, steps, room });

  // Only what a fresh machine has: no inherited Claude, harness or setup variables.
  const base = { PATH: env.PATH, HOME: home, TMPDIR: join(room, 'tmp'), LANG: env.LANG ?? 'C.UTF-8' };
  mkdirSync(base.TMPDIR);
  const harness = { CCP_HARNESS_DIR: join(project, 'harness'), CCP_REPO: repo };
  step('empty', !readdirSync(home).length && !readdirSync(project).length, `HOME ${home} and project ${project} start empty`);

  // 1. The setup script, as a container build runs it.
  const log = join(room, 'setup.log');
  const fetch = ref ? { CCP_SETUP_FETCH: '0', CCP_SETUP_REF: ref } : {};
  spawnSync('bash', [join(repo, 'infra', 'cloud-environment', 'setup.sh')], { env: { ...base, CCP_SETUP_LOG: log, ...fetch }, encoding: 'utf8' });
  const setupLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const root = join(home, '.claude', 'skills', PLUGIN);
  const installedLine = setupLog.split('\n').find((l) => l.startsWith('plugin ')) ?? 'no plugin line in the setup log';
  if (!step('setup', existsSync(join(root, 'release.json')), `${installedLine}${existsSync(root) ? '' : `; ${root} was not created`}`)) return done(null, null);

  // 2. Install the harness in the empty project, as the install skill does.
  const install = spawnSync(process.execPath, [join(root, 'scripts', 'install.mjs')], { cwd: project, env: { ...base, ...harness }, encoding: 'utf8' });
  if (!step('install', install.status === 0, (install.stdout + install.stderr).trim())) return done(null, null);

  // 3. One session in the project.
  const useClaude = session === 'claude' || (session === 'auto' && !!env.ANTHROPIC_API_KEY);
  let mode, line = null;
  if (useClaude) {
    mode = 'claude -p';
    const keys = env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {};
    const run = spawnSync('claude', ['-p', 'Reply with the single word OK.', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'],
      { cwd: project, env: { ...base, ...keys, ...harness }, encoding: 'utf8', timeout: SESSION_TIMEOUT_MS, input: '' });
    const { ran, hook } = harnessHook(run.stdout ?? '');
    if (hook) line = contextLine(hook.output || hook.stdout || hook.stderr);
    const why = run.error ? `claude -p could not run (${run.error.message})`
      : !ran ? `Claude Code ran no SessionStart hook (exit ${run.status}): ${(run.stderr || run.stdout || '').trim().slice(-400)}`
      : `Claude Code ran ${ran} SessionStart hook(s) but none was ${PLUGIN}'s, so it did not load the plugin at ${root}; check .claude-plugin/plugin.json and hooks/hooks.json there`;
    if (!step('session', !!hook, hook ? `claude -p ran ${PLUGIN}'s SessionStart hook (exit ${run.status})` : why)) return done(mode, line);
  } else {
    mode = 'hooks without a model';
    let hooks;
    try {
      hooks = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart.flatMap((h) => h.hooks);
    } catch (error) {
      step('session', false, `the plugin's hooks/hooks.json could not be read (${error.message}), so Claude Code would run none of its hooks`);
      return done(mode, line);
    }
    const input = JSON.stringify({ session_id: `clean-room-${Date.now()}`, transcript_path: '', cwd: project, hook_event_name: 'SessionStart', source: 'startup' });
    for (const hook of hooks) {
      const run = spawnSync('sh', ['-c', hook.command], {
        cwd: project, input, encoding: 'utf8', timeout: (hook.timeout ?? 60) * 1000,
        env: { ...base, ...harness, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: project }
      });
      const said = contextLine(run.stdout) || (run.stderr ?? '').trim();
      if (/ccp-harness/.test(said)) line = said;
      step('session', run.status === 0, `${hook.command} exited ${run.status}${run.status === 0 ? '' : `: ${(run.stderr ?? '').trim().slice(-400)}`}`);
    }
  }

  // 4. The self-check passed, and the journal holds the session's fingerprint and self-check rows.
  step('selfcheck', /self-check passed/.test(line ?? ''), line ?? `${PLUGIN} said nothing at session start`);
  const sessions = join(harness.CCP_HARNESS_DIR, 'journal', 'sessions');
  const files = existsSync(sessions) ? readdirSync(sessions) : [];
  const rows = files.flatMap((f) => readFileSync(join(sessions, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const kinds = rows.map((r) => r.kind);
  const check = rows.find((r) => r.kind === 'session.selfcheck');
  step('journal', kinds.includes('session.fingerprint') && check?.payload?.passed === true,
    `${files.length} session file(s), rows: ${kinds.join(', ') || 'none'}${check ? `; self-check passed: ${check.payload.passed}` : ''}`);
  return done(mode, line);
}

/** The report, as markdown. */
export function report(r) {
  const out = [`### clean room: ${r.passed ? 'PASSED' : 'FAILED'}`, '', `Session: ${r.mode ?? 'not started'}`, ''];
  if (r.line) out.push('Self-check line:', '', '```', r.line, '```', '');
  for (const s of r.steps) out.push(`- ${s.ok ? 'ok' : 'FAILED'} ${s.step}: ${s.detail}`);
  return `${out.join('\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = args(process.argv.slice(2));
  const result = cleanRoom(opts);
  const text = report(result);
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  if (!opts.keep) rmSync(result.room, { recursive: true, force: true });
  else process.stdout.write(`room kept at ${result.room}\n`);
  process.exit(result.passed ? 0 : 1);
}
