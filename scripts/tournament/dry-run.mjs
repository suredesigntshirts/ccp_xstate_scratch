#!/usr/bin/env node
// Runs runner.workflow.js outside the Workflow tool, with stub agents, so a tournament's args can be checked before
// a real run spends tokens (plan item tournament-kit).
//
//   node scripts/tournament/dry-run.mjs args.json      prints every agent call (label, phase, prompt size) and the result
//
// The stubs follow the Workflow tool's hooks as its reference describes them: pipeline() runs each item through every
// stage with no barrier, parallel() is a barrier whose failed thunks become null, agent() with a schema returns an
// object of that shape. A stub agent answers from the schema alone; tests pass their own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
export const RUNNER = path.join(KIT, 'runner.workflow.js');

/** A value of the schema's shape: required fields filled with empty values; arrays of lane ids where named so. */
export function fake(schema, ctx = {}) {
  if (!schema) return 'ok';
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const k of schema.required || []) out[k] = fake(schema.properties?.[k], { ...ctx, key: k });
      return out;
    }
    case 'array':
      return ctx.key === 'ranking' ? [...(ctx.laneNames || [])] : [];
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    default:
      return ctx.key ? `stub ${ctx.key}` : 'stub';
  }
}

/** Runs the runner script with the given args. `agent(prompt, opts)` defaults to a schema-shaped stub. */
export async function dryRun(args, { agent, script = fs.readFileSync(RUNNER, 'utf8') } = {}) {
  const calls = [];
  const logs = [];
  const phases = [];
  const laneNames = (args?.lanes || []).map((l) => l.alias || l.id);
  const stub = agent || (async (_prompt, opts) => fake(opts?.schema, { laneNames }));
  const hooks = {
    args,
    agent: async (prompt, opts = {}) => {
      if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error(`agent ${opts.label}: empty prompt`);
      calls.push({ label: opts.label, phase: opts.phase, prompt, schema: opts.schema });
      return stub(prompt, opts);
    },
    parallel: async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null))),
    pipeline: async (items, ...stages) =>
      Promise.all(
        items.map(async (item, i) => {
          let v = item;
          try {
            for (const st of stages) v = await st(v, item, i);
            return v;
          } catch {
            return null;
          }
        })
      ),
    phase: (t) => phases.push(t),
    log: (m) => logs.push(m),
    budget: { total: null, spent: () => 0, remaining: () => Infinity }
  };
  if (!/^export const meta = \{/.test(script)) throw new Error('runner: a Workflow script must begin with export const meta');
  const body = script.replace(/^export const meta =/, 'const meta =');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction(...Object.keys(hooks), body);
  const result = await run(...Object.values(hooks));
  return { result, calls, logs, phases };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/tournament/dry-run.mjs args.json');
    process.exit(2);
  }
  const { result, calls, logs } = await dryRun(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const c of calls) console.log(`agent ${c.label} [${c.phase}] prompt ${c.prompt.length} chars${c.schema ? ', schema' : ''}`);
  for (const l of logs) console.log(`log ${l}`);
  console.log(JSON.stringify(result, null, 2));
}
