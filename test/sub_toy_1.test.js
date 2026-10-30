import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sub_toy_1 } from '../src.js';

test('sub_toy_1', () => {
  assert.equal(sub_toy_1(5, 3), 2);
  assert.equal(sub_toy_1(0, 4), -4);
  assert.equal(sub_toy_1(2, 2), 0);
});
