#!/usr/bin/env node
// Checks the plan: every head matches item.schema.json, every id it names exists, depends_on has no
// cycle and never points at a later stage, and a ready item has every readyRequired field filled.
// Zero dependencies; it reads only the small part of JSON Schema that item.schema.json uses.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const mdFiles = (dir) => existsSync(join(root, dir))
  ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => join(dir, f))
  : [];

function head(path) {
  const m = readFileSync(join(root, path), 'utf8').match(/^```json\n([\s\S]*?)\n```/);
  if (!m) return fail(path, 'must start with a ```json head');
  try { return JSON.parse(m[1]); } catch (e) { fail(path, `head is not JSON: ${e.message}`); }
}

function validate(schema, value, where) {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(where, 'must be an object');
    for (const k of schema.required ?? []) if (!(k in value)) fail(where, `missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) validate(schema.properties[k], v, `${where}.${k}`);
      else if (schema.additionalProperties === false) fail(where, `unknown field ${k}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return fail(where, 'must be an array');
    value.forEach((v, i) => schema.items && validate(schema.items, v, `${where}[${i}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return fail(where, 'must be a string');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(where, `must match ${schema.pattern}`);
    if (schema.enum && !schema.enum.includes(value)) fail(where, `must be one of ${schema.enum.join(', ')}`);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return fail(where, 'must be an integer');
    if (schema.minimum !== undefined && value < schema.minimum) fail(where, `must be at least ${schema.minimum}`);
  }
}

const empty = (v) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const anchors = (dir, prefix) => new Set(mdFiles(dir).flatMap((p) =>
  [...readFileSync(join(root, p), 'utf8').matchAll(new RegExp(`^#+ (${prefix}-[a-z0-9-]+)`, 'gm'))].map((m) => m[1])));

const schema = JSON.parse(readFileSync(join(root, 'item.schema.json'), 'utf8'));
const ledger = anchors('ledger', 'L');
const cases = anchors('cases', 'C');

const stages = new Map();
for (const p of mdFiles('stages')) {
  const h = head(p);
  if (!h) continue;
  if (h.id !== basename(p, '.md')) fail(p, `id ${h.id} must equal the file name`);
  if (typeof h.order !== 'number') fail(p, 'order must be a number');
  if (empty(h.gate)) fail(p, 'a stage needs an exit gate');
  for (const k of ['title', 'goal']) if (typeof h[k] !== 'string' || !h[k]) fail(p, `a stage needs ${k}`);
  for (const [i, g] of (h.gate ?? []).entries())
    for (const k of ['id', 'check', 'how']) if (!g?.[k]) fail(p, `gate[${i}] needs ${k}`);
  stages.set(h.id, h);
}

const isLive = (i) => !['split', 'merged', 'dropped', 'parked'].includes(i.status);
const items = new Map();
for (const p of mdFiles('items')) {
  const h = head(p);
  if (!h) continue;
  validate(schema, h, p);
  if (h.id !== basename(p, '.md')) fail(p, `id ${h.id} must equal the file name`);
  items.set(h.id, { ...h, path: p });
}

for (const it of items.values()) {
  const at = it.path;
  if (!stages.has(it.stage)) fail(at, `unknown stage ${it.stage}`);
  for (const d of it.depends_on ?? []) {
    const dep = items.get(d);
    if (!dep) { fail(at, `depends on unknown item ${d}`); continue; }
    if (stages.has(it.stage) && stages.has(dep.stage) && stages.get(dep.stage).order > stages.get(it.stage).order)
      fail(at, `depends on ${d}, which is in a later stage`);
  }
  for (const r of it.replaced_by ?? []) if (!items.has(r)) fail(at, `replaced by unknown item ${r}`);
  if (it.status === 'split' && empty(it.replaced_by)) fail(at, 'a split item names replaced_by');
  if (it.status === 'merged' && !items.has(it.merged_into)) fail(at, 'a merged item names an existing merged_into');
  if (['dropped', 'parked'].includes(it.status) && empty(it.why)) fail(at, `a ${it.status} item says why`);
  if (isLive(it)) for (const d of it.depends_on ?? [])
    if (items.has(d) && !isLive(items.get(d))) fail(at, `live item depends on ${d}, which is ${items.get(d).status}`);
  for (const l of it.serves ?? []) if (!ledger.has(l)) fail(at, `serves unknown ledger row ${l}`);
  for (const c of it.cases ?? []) if (!cases.has(c)) fail(at, `names unknown case ${c}`);
  if (it.status === 'ready') {
    for (const k of schema.readyRequired) if (empty(it[k])) fail(at, `ready, but ${k} is empty`);
    // Proof rules (ledger L-proof-source): a build item touches the real world before accept, and the builder's own
    // tests prove at most half of it.
    const proofs = (it.expect ?? []).map((e) => e.proof);
    if (it.kind === 'build' && !proofs.includes('world')) fail(at, 'a ready build item needs an Expect line with proof world');
    if (it.kind === 'build' && proofs.filter((p) => p === 'builder').length * 2 > proofs.length)
      fail(at, 'more than half its Expect lines are proven by the builder alone');
    const brief = readFileSync(join(root, at), 'utf8').split(/^## Verifier brief$/m)[1];
    if (it.kind !== 'decision' && !brief?.trim()) fail(at, 'a ready item needs a ## Verifier brief section');
    for (const c of brief?.match(/C-[a-z0-9-]+[a-z0-9]/g) ?? [])
      if (!(it.cases ?? []).includes(c)) fail(at, `its Verifier brief names ${c}, which its head doesn't`);
  }
}

// A cycle in depends_on means no order exists.
const state = new Map();
const visit = (id, trail) => {
  if (state.get(id) === 'done' || !items.has(id)) return;
  if (state.get(id) === 'open') return fail(items.get(id).path, `depends_on cycle: ${[...trail, id].join(' -> ')}`);
  state.set(id, 'open');
  for (const d of items.get(id).depends_on ?? []) visit(d, [...trail, id]);
  state.set(id, 'done');
};
for (const id of items.keys()) visit(id, []);

// --order prints the items stage by stage, each after what it depends on.
if (process.argv.includes('--order')) {
  const done = new Set();
  const byStage = [...stages.values()].sort((a, b) => a.order - b.order);
  for (const st of byStage) {
    console.log(`\n${st.id}: ${st.title}`);
    const mine = [...items.values()].filter((i) => i.stage === st.id && isLive(i));
    let left = mine.filter((i) => !done.has(i.id));
    while (left.length) {
      const next = left.find((i) => (i.depends_on ?? []).every((d) => done.has(d) || items.get(d)?.stage !== st.id));
      if (!next) { fail(st.id, `no order exists for ${left.map((i) => i.id).join(', ')}`); break; }
      console.log(`  ${next.id.padEnd(32)} ${next.kind.padEnd(9)} ${next.status.padEnd(7)} after: ${(next.depends_on ?? []).join(', ') || '-'}`);
      done.add(next.id);
      left = left.filter((i) => i !== next);
    }
  }
}

// --coverage lists ledger rows no item serves (rows whose fate is drop are exempt).
if (process.argv.includes('--coverage')) {
  const served = new Set([...items.values()].filter(isLive).flatMap((i) => i.serves ?? []));
  // Split each ledger file into rows at its headings, so a row's fate is read from that row only.
  const dropped = new Set(mdFiles('ledger').flatMap((p) => readFileSync(join(root, p), 'utf8').split(/^(?=### L-)/m)
    .filter((row) => /^\*\*Fate:\*\* drop/m.test(row)).map((row) => row.match(/^### (L-[a-z0-9-]+)/)?.[1]).filter(Boolean)));
  const unserved = [...ledger].filter((l) => !served.has(l) && !dropped.has(l));
  console.log(unserved.length ? `ledger rows no item serves:\n  ${unserved.join('\n  ')}` : 'every ledger row is served');
}

const live = [...items.values()].filter(isLive);
console.log(`${stages.size} stages, ${items.size} items (${live.length} live), ${ledger.size} ledger rows, ${cases.size} cases`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('plan ok');
