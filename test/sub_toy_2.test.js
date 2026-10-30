import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sub_toy_2 } from '../src.js';

test('sub_toy_2', () => {
  assert.equal(sub_toy_2(5, 3), 2);
  assert.equal(sub_toy_2(3, 5), -2);
  assert.equal(sub_toy_2(0, 0), 0);
});
