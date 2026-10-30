import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sub_toy_v1 } from '../src.js';

test('sub_toy_v1', () => {
  assert.equal(sub_toy_v1(5, 3), 2);
  assert.equal(sub_toy_v1(0, 4), -4);
  assert.equal(sub_toy_v1(-2, -3), 1);
  assert.equal(sub_toy_v1(3, -2), 5);
});
