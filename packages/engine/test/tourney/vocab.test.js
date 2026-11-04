// Round 2 (deletion): the three design-B workflows use only the guard forms present, in and same. `is` and `below`
// are deleted from the design's vocabulary: `{ path, is: x }` is `{ path, in: [x] }`, and `{ path, below: n }` on a
// counter that only `set 0` and `inc` write is `{ path, in: [0, …, n-1] }`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow } from '../../src/index.js';

const formOf = (condition) => (typeof condition === 'string' ? 'present' : Object.keys(condition).filter((k) => k !== 'path').join('+'));

test('vocab: quick-fix, feature and research use only present, in and same', () => {
  const forms = new Set();
  for (const name of ['quick-fix', 'feature', 'research']) {
    for (const conditions of Object.values(loadWorkflow(name).meta.guards)) for (const c of conditions) forms.add(formOf(c));
  }
  assert.deepEqual([...forms].sort(), ['in', 'present', 'same']);
});
