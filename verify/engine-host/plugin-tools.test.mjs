// no-agent-events, part 1: what the harness plugin registers. Hooks, one skill and, since plan item engine-actors,
// one MCP tool: the return tool, whose only effect on an item is the done event of a run the actor hook checked
// (packages/engine/src/actors.js, accept and resultsOf). Nothing the plugin registers takes an event or its source as
// an argument, and no plugin script reads wakes or applies events itself.
// Narrowed by engine-actors (plan/decisions/2026-10-30-engine-actors.md): it used to say no .mcp.json exists and no
// script names packages/engine at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const plugin = new URL('../../plugins/harness/', import.meta.url).pathname;
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'test' || e.name === 'node_modules' ? [] : walk(join(d, e.name))) : [join(d, e.name)]));

test('plugin.json declares no MCP servers, tools, agents or commands; .mcp.json declares only the return tool server', () => {
  const manifest = JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8'));
  for (const key of ['mcpServers', 'tools', 'agents', 'commands', 'lspServers']) assert.equal(manifest[key], undefined, key);
  const servers = JSON.parse(readFileSync(join(plugin, '.mcp.json'), 'utf8')).mcpServers;
  assert.deepEqual(Object.keys(servers), ['harness']);
  assert.deepEqual(servers.harness.args, ['${CLAUDE_PLUGIN_ROOT}/scripts/return-tool.mjs']);
  assert.deepEqual(readdirSync(join(plugin, 'skills')), ['install']);
});

test('the return tool server lists one tool, return, taking only a run and a result, and imports no engine code', () => {
  const source = readFileSync(join(plugin, 'scripts', 'return-tool.mjs'), 'utf8');
  assert.match(source, /name: 'return'/);
  assert.match(source, /required: \['run', 'result'\]/);
  assert.doesNotMatch(source, /from '[^']*engine|import\([^)]*engine|applyEvent|offer\(/);
});

test('no plugin script reads wakes, runs the engine host command or applies an event; only the actor hook loads the engine', () => {
  const files = walk(plugin).filter((f) => /\.(m?js|json|md)$/.test(f) && !f.includes('/pages/'));
  assert.deepEqual(files.filter((f) => /engine\/bin\/host|applyEvent|inputsOfWake/.test(readFileSync(f, 'utf8'))), []);
  const loaders = files.filter((f) => /engine\(['"]/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(plugin.length));
  assert.deepEqual(loaders, ['scripts/actors.mjs']);
});
