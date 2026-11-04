#!/usr/bin/env node
// The return tool (plan item engine-actors): the harness's MCP server, `harness`, with one tool, `return`. An invoked
// actor hands back its result with it: { run, result }. The checks are not here. The PreToolUse hook (actors.mjs)
// runs them before the call reaches this server, refuses a call that fails one, and stores the result of one that
// passes. So this server only answers whether that happened: it says accepted when the run's stored result is this
// result, and refuses anything else, such as a call made while the hook was not running.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { journalDir } from './host.mjs';

const TOOL = {
  name: 'return',
  description: 'Hand your result back to the ccp-harness run that started you. Only the agent a run started may call it for that run; the result must match the run\'s schema, and a claimed PR must be on GitHub at the claimed head.',
  inputSchema: {
    type: 'object',
    required: ['run', 'result'],
    properties: {
      run: { type: 'string', description: 'Your run, as the harness gave it: <item>:<seq>.<actor>' },
      result: { type: 'object', description: 'Your result, matching the schema the harness gave you' }
    }
  }
};

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

// Whether the hook stored exactly this result for this run.
function answer({ run, result } = {}) {
  const m = String(run ?? '').match(/^(.+):(\d+\.[\w-]+)$/);
  let stored = null;
  if (m) {
    try {
      stored = JSON.parse(readFileSync(join(journalDir(), 'items', safe(m[1]), 'runs', safe(m[2]), 'result.json'), 'utf8'));
    } catch {}
  }
  if (stored && stored.hash === sha256(JSON.stringify(result))) {
    return { content: [{ type: 'text', text: `accepted: run ${run}'s result is stored (${stored.hash.slice(0, 12)}). You are done.` }] };
  }
  return { isError: true, content: [{ type: 'text', text: `not accepted: no harness check passed this result for run ${run}. The harness hook checks every return; without it nothing is accepted.` }] };
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id === undefined) return; // a notification
  if (m.method === 'initialize') {
    return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'harness', version: '1' } } });
  }
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: [TOOL] } });
  if (m.method === 'tools/call') {
    if (m.params?.name !== TOOL.name) return send({ id: m.id, error: { code: -32602, message: `no tool ${m.params?.name}` } });
    return send({ id: m.id, result: answer(m.params.arguments) });
  }
  if (m.method === 'ping') return send({ id: m.id, result: {} });
  send({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
});
