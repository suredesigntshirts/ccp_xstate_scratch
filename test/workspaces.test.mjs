// The workspace layout: every package under packages/ and plugins/ runs on Node 22+ and depends at runtime on
// nothing but xstate and its sibling workspaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const workspaces = ['packages', 'plugins'].flatMap((dir) => existsSync(join(root, dir))
  ? readdirSync(join(root, dir)).filter((d) => existsSync(join(root, dir, d, 'package.json'))).map((d) => join(dir, d))
  : []);

test('the root declares the workspaces and Node 22+', () => {
  assert.deepEqual(rootPkg.workspaces, ['packages/*', 'plugins/*']);
  assert.equal(rootPkg.engines.node, '>=22');
  assert.equal(rootPkg.dependencies, undefined);
});

test('no workspace depends at runtime on anything but xstate or a sibling', () => {
  const names = new Set(workspaces.map((w) => JSON.parse(readFileSync(join(root, w, 'package.json'), 'utf8')).name));
  for (const w of workspaces) {
    const deps = Object.keys(JSON.parse(readFileSync(join(root, w, 'package.json'), 'utf8')).dependencies ?? {});
    assert.deepEqual(deps.filter((d) => d !== 'xstate' && !names.has(d)), [], `${w} has other runtime dependencies`);
  }
});
