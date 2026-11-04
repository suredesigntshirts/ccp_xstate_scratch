// Fail closed: every guard in the workflow fails when any field it reads is absent. One test per guard, built
// from the guard's own conditions, so a guard added later is covered too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failing } from '../src/index.js';
import { workflow } from './flow.js';

// Write value at a dotted path into a plain object.
const put = (root, path, value) => {
  const keys = path.split('.');
  keys.slice(0, -1).reduce((at, key) => (at[key] ??= {}), root)[keys.at(-1)] = value;
  return root;
};
const drop = (root, path) => {
  const copy = structuredClone(root);
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((at, key) => at?.[key], copy);
  if (parent) delete parent[keys.at(-1)];
  return copy;
};
// The paths a condition reads.
const pathsOf = (c) => (typeof c === 'string' ? [c] : [c.path, ...('same' in c ? [c.same] : [])]);
// A scope in which every condition holds.
const holding = (conditions) =>
  conditions.reduce((scope, c) => {
    if (typeof c === 'string') return put(scope, c, 'x');
    if ('is' in c) return put(scope, c.path, c.is);
    if ('in' in c) return put(scope, c.path, c.in[0]);
    if ('same' in c) return put(put(scope, c.path, 's'), c.same, 's');
    if ('below' in c) return put(scope, c.path, c.below - 1);
    throw new Error(`unknown condition ${JSON.stringify(c)}`);
  }, {});

for (const [name, conditions] of Object.entries(workflow.meta.guards)) {
  test(`fail-closed: ${name} fails when any field it reads is absent`, () => {
    const scope = holding(conditions);
    assert.deepEqual(failing(workflow, [name], scope), [], `${name} holds when all its fields are there`);
    for (const p of conditions.flatMap(pathsOf)) {
      assert.deepEqual(failing(workflow, [name], drop(scope, p)), [name], `${name} with ${p} absent`);
    }
    assert.deepEqual(failing(workflow, [name], {}), [name], `${name} with an empty scope`);
  });
}

test('fail-closed: a below condition fails on null or a non-number, not only on absent', () => {
  for (const builds of [null, '0', undefined]) {
    assert.deepEqual(failing(workflow, ['buildsLeft'], { context: { builds } }), ['buildsLeft'], `builds ${builds}`);
  }
  assert.deepEqual(failing(workflow, ['buildsLeft'], { context: { builds: 1 } }), []);
});
