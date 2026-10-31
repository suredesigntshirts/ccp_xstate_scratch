import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sub_iv1 } from '../src.js';

test('sub_iv1', () => {
  assert.equal(sub_iv1(5, 3), 2);
  assert.equal(sub_iv1(3, 5), -2);
  assert.equal(sub_iv1(0, 0), 0);
  assert.equal(sub_iv1(-2, -3), 1);
  assert.equal(sub_iv1(3, -2), 5);
});
