#!/usr/bin/env node
// Builds the Workflow args for scripts/tournament/runner.workflow.js from a tournament folder, and refuses a folder
// whose config is missing anything the run is pinned to (plan item tournament-kit, docs/tournaments.md).
//
//   node scripts/tournament/args.mjs tournaments/<id> [--out args.json]
//
// A role's prompt is <folder>/prompts/<role>.md if the folder has one, else scripts/tournament/prompts/<role>.md.
// Its output schema is <folder>/schemas/<role>.json, else scripts/tournament/schemas/<role>.json, else none.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const HEX = /^[0-9a-f]{7,40}$/;
// The names a role prompt may use in {{...}}; the runner fills them per call (runner.workflow.js scopeFor).
const ROOTS = new Set(['tournament', 'question', 'pack', 'scoring', 'vars', 'stage', 'stages', 'lanes', 'lane', 'prev', 'brief']);
const LANE_ONLY = new Set(['lane', 'prev']);

export class ConfigError extends Error {}

const need = (cond, msg) => {
  if (!cond) throw new ConfigError(msg);
};
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** Checks a parsed config.json; throws ConfigError naming the first missing or wrong field. */
export function checkConfig(c) {
  need(c && typeof c === 'object', 'config.json must be an object');
  need(nonEmpty(c.id), 'config.id is required');
  need(nonEmpty(c.question), 'config.question is required');
  need(c.base && typeof c.base === 'object', 'config.base is required (the repo and sha the lanes start from)');
  need(nonEmpty(c.base.repo), 'config.base.repo is required');
  need(HEX.test(c.base.sha ?? ''), 'config.base.sha is required (a commit sha)');
  need(c.runner && typeof c.runner === 'object', 'config.runner is required (the runner sha the run is pinned to)');
  need(HEX.test(c.runner.sha ?? ''), 'config.runner.sha is required (a commit sha)');
  need(c.scoring && typeof c.scoring === 'object', 'config.scoring is required, written before the run');
  need(nonEmpty(c.scoring.rule), 'config.scoring.rule is required');

  need(Array.isArray(c.lanes) && c.lanes.length > 0, 'config.lanes is required (one or more lanes)');
  const laneIds = new Set();
  for (const [i, l] of c.lanes.entries()) {
    need(l && nonEmpty(l.id), `config.lanes[${i}].id is required`);
    need(/^[\w.-]+$/.test(l.id), `config.lanes[${i}].id must be a branch-safe name`);
    need(!laneIds.has(l.id), `config.lanes: duplicate lane ${l.id}`);
    laneIds.add(l.id);
  }
  const aliases = c.lanes.map((l) => l.alias).filter(Boolean);
  need(new Set(aliases).size === aliases.length, 'config.lanes: duplicate alias');

  need(Array.isArray(c.stages) && c.stages.length > 0, 'config.stages is required (one or more stages)');
  const seen = new Map();
  for (const [i, s] of c.stages.entries()) {
    need(s && nonEmpty(s.id), `config.stages[${i}].id is required`);
    need(!seen.has(s.id), `config.stages: duplicate stage ${s.id}`);
    need(nonEmpty(s.role), `config.stages[${i}] (${s.id}).role is required`);
    need(s.over === 'each' || s.over === 'all', `config.stages[${i}] (${s.id}).over must be "each" or "all"`);
    if (s.pick) {
      need(s.over === 'each', `stage ${s.id}: pick needs over "each"`);
      need(seen.get(s.pick.from)?.over === 'all', `stage ${s.id}: pick.from must name an earlier "all" stage`);
      for (const id of [...(s.pick.plus || []), ...(s.pick.exclude || [])])
        need(laneIds.has(id), `stage ${s.id}: pick names unknown lane ${id}`);
    }
    seen.set(s.id, s);
  }
  for (const l of c.lanes) {
    for (const id of [...(l.skip || []), ...Object.keys(l.given || {}), ...Object.keys(l.brief || {})])
      need(seen.has(id), `lane ${l.id} names unknown stage ${id}`);
  }
  return c;
}

/** Placeholder roots a template uses, e.g. {{lane.id}} -> lane. */
export function placeholders(text) {
  return [...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]);
}

function checkTemplate(text, where, { lane }) {
  for (const p of placeholders(text)) {
    const root = p.split('.')[0];
    need(ROOTS.has(root), `${where} names {{${p}}}; a prompt may use ${[...ROOTS].join(', ')}`);
    need(lane || !LANE_ONLY.has(root), `${where} names {{${p}}}, but its stage runs once over all lanes`);
  }
}

function readFirst(files) {
  for (const f of files) if (fs.existsSync(f)) return { file: f, text: fs.readFileSync(f, 'utf8') };
  return null;
}

/** Builds the runner's args from a tournament folder. Throws ConfigError if the folder is incomplete. */
export function buildArgs(folder) {
  const cfgFile = path.join(folder, 'config.json');
  need(fs.existsSync(cfgFile), `${cfgFile} not found`);
  let c;
  try {
    c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  } catch (e) {
    throw new ConfigError(`${cfgFile}: ${e.message}`);
  }
  checkConfig(c);
  need(path.basename(path.resolve(folder)) === c.id, `config.id ${c.id} must match its folder name`);

  const packFile = path.join(folder, c.pack || 'pack.md');
  need(fs.existsSync(packFile), `the pack ${packFile} is required`);

  const roles = {};
  for (const s of c.stages) {
    const lane = s.over === 'each';
    if (!roles[s.role]) {
      const prompt = readFirst([path.join(folder, 'prompts', `${s.role}.md`), path.join(KIT, 'prompts', `${s.role}.md`)]);
      need(prompt, `role ${s.role} has no prompt (prompts/${s.role}.md in the folder or the kit)`);
      const schema = readFirst([path.join(folder, 'schemas', `${s.role}.json`), path.join(KIT, 'schemas', `${s.role}.json`)]);
      roles[s.role] = { prompt: prompt.text, ...(schema && { schema: JSON.parse(schema.text) }), _file: prompt.file };
    }
    checkTemplate(roles[s.role].prompt, `prompt ${path.relative(process.cwd(), roles[s.role]._file)} (stage ${s.id})`, { lane });
    if (s.brief) checkTemplate(s.brief, `stage ${s.id} brief`, { lane });
  }
  for (const l of c.lanes)
    for (const [sid, b] of Object.entries(l.brief || {})) checkTemplate(b, `lane ${l.id} brief for ${sid}`, { lane: true });
  for (const s of c.stages.filter((x) => x.over === 'each')) {
    const texts = [roles[s.role].prompt, s.brief || ''];
    for (const l of c.lanes.filter((x) => !(x.skip || []).includes(s.id))) {
      const lane = { ...l, name: l.alias || l.id };
      for (const p of texts.flatMap(placeholders).filter((x) => x.startsWith('lane.'))) {
        const v = p.split('.').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), lane);
        need(v !== undefined, `stage ${s.id} uses {{${p}}}, but lane ${l.id} has no value for it`);
      }
    }
  }
  for (const r of Object.values(roles)) delete r._file;

  return {
    id: c.id,
    question: c.question,
    pack: fs.readFileSync(packFile, 'utf8'),
    scoring: c.scoring,
    vars: c.vars || {},
    lanes: c.lanes.map((l) => ({ ...l, skip: l.skip || [], given: l.given || {}, brief: l.brief || {} })),
    stages: c.stages.map((s) => ({ id: s.id, title: s.title || s.id, role: s.role, over: s.over, ...(s.pick && { pick: s.pick }), ...(s.brief && { brief: s.brief }) })),
    roles
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [folder, ...rest] = process.argv.slice(2);
  if (!folder) {
    console.error('usage: node scripts/tournament/args.mjs tournaments/<id> [--out args.json]');
    process.exit(2);
  }
  try {
    const json = JSON.stringify(buildArgs(folder), null, 2);
    const out = rest[rest.indexOf('--out') + 1];
    if (rest.includes('--out') && out) fs.writeFileSync(out, json + '\n');
    else process.stdout.write(json + '\n');
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`args: refused: ${e.message}`);
    process.exit(1);
  }
}
