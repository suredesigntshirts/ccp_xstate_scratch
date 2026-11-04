#!/usr/bin/env node
// Runs a tournament's shared suite and its measure in one lane's checkout and writes the result as JSON (plan item
// tournament-kit). CI runs this on every lane PR (ci/tournament.yml), so the scores come from a script, not an agent.
//
//   node scripts/tournament/measure.mjs --tournament tournaments/<id> --lane <lane> [--checkout <dir>]
//        [--out <file>] [--scores] [--summary <file>]
//
// config.suite.command is the suite, run in the checkout ([cmd, ...args], no shell). Its TAP summary lines
// (# tests, # pass, # fail, # skipped, # todo) are read if it prints them. config.measure names a module in the
// tournament folder whose measure({ checkout, config, lane }) returns the tournament's own measures.
// --scores merges the result into <tournament>/scores.json; --summary appends a Markdown table to the file
// (default $GITHUB_STEP_SUMMARY).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkConfig, ConfigError } from './args.mjs';

/** Reads a TAP stream's summary and its failing test names. */
export function parseTap(text) {
  const n = (k) => {
    const m = text.match(new RegExp(`^# ${k} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const failing = [...text.matchAll(/^\s*not ok \d+ - (.*?)(?: #.*)?$/gm)].map((m) => m[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), todo: n('todo'), failing };
}

export function runSuite(suite, checkout) {
  const [cmd, ...argv] = suite.command;
  // A suite started from inside node --test would otherwise report to that runner instead of printing TAP.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(cmd, argv, { cwd: path.join(checkout, suite.cwd || '.'), env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: (suite.timeoutSeconds || 900) * 1000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  return { command: suite.command.join(' '), exit: r.status, ...(r.error && { error: r.error.message }), ...parseTap(out) };
}

function headOf(checkout) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Measures one lane checkout against a tournament folder. */
export async function measureLane({ tournament, lane, checkout = '.' }) {
  const config = checkConfig(JSON.parse(fs.readFileSync(path.join(tournament, 'config.json'), 'utf8')));
  if (!config.lanes.some((l) => l.id === lane)) throw new ConfigError(`lane ${lane} is not in ${config.id}'s config.lanes`);
  if (!config.suite && !config.measure) throw new ConfigError(`${config.id} has neither suite nor measure to run`);
  const result = { tournament: config.id, lane, sha: headOf(checkout), runner: config.runner.sha, measuredAt: new Date().toISOString() };
  if (config.suite) {
    if (!Array.isArray(config.suite.command) || config.suite.command.length === 0)
      throw new ConfigError('config.suite.command must be [cmd, ...args]');
    result.suite = runSuite(config.suite, checkout);
  }
  if (config.measure) {
    const mod = await import(pathToFileURL(path.resolve(tournament, config.measure)).href);
    const fn = mod.measure || mod.default;
    if (typeof fn !== 'function') throw new ConfigError(`${config.measure} exports no measure()`);
    result.measures = await fn({ checkout: path.resolve(checkout), config, lane });
  }
  return result;
}

/** Markdown for a job summary: the suite line, then each measure as a row. */
export function summary(r) {
  const lines = [`## Tournament ${r.tournament}: lane ${r.lane}`, '', `Head \`${r.sha}\`, runner \`${r.runner}\`.`, ''];
  if (r.suite) {
    const s = r.suite;
    lines.push('| Suite | Tests | Pass | Fail | Skipped | Exit |', '|---|---|---|---|---|---|');
    lines.push(`| \`${s.command}\` | ${s.tests ?? '?'} | ${s.pass ?? '?'} | ${s.fail ?? '?'} | ${s.skipped ?? '?'} | ${s.exit} |`, '');
    if (s.failing.length) lines.push(`Failing: ${s.failing.map((f) => `\`${f}\``).join(', ')}`, '');
  }
  if (r.measures) {
    lines.push('| Measure | Value |', '|---|---|');
    for (const [k, v] of Object.entries(r.measures)) lines.push(`| ${k} | \`${JSON.stringify(v).replace(/\|/g, '\\|')}\` |`);
    lines.push('');
  }
  return lines.join('\n');
}

function opt(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const tournament = opt(argv, '--tournament');
  const lane = opt(argv, '--lane');
  if (!tournament || !lane) {
    console.error('usage: node scripts/tournament/measure.mjs --tournament tournaments/<id> --lane <lane> [--checkout dir] [--out file] [--scores] [--summary [file]]');
    process.exit(2);
  }
  let r;
  try {
    r = await measureLane({ tournament, lane, checkout: opt(argv, '--checkout') || '.' });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`measure: refused: ${e.message}`);
    process.exit(1);
  }
  const json = JSON.stringify(r, null, 2) + '\n';
  if (opt(argv, '--out')) fs.writeFileSync(opt(argv, '--out'), json);
  else process.stdout.write(json);
  if (argv.includes('--scores')) {
    const file = path.join(tournament, 'scores.json');
    const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { tournament: r.tournament, lanes: {} };
    all.lanes[lane] = r;
    all.lanes = Object.fromEntries(Object.entries(all.lanes).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  }
  if (argv.includes('--summary')) {
    const file = opt(argv, '--summary') || process.env.GITHUB_STEP_SUMMARY;
    if (file) fs.appendFileSync(file, summary(r) + '\n');
    else process.stdout.write(summary(r) + '\n');
  }
  if (r.suite && (r.suite.exit === null || r.suite.tests === null)) {
    console.error('measure: the suite did not run to a TAP summary');
    process.exit(1);
  }
}
