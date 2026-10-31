import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mul_sa1 } from '../src.js';

test('mul_sa1', () => {
  assert.equal(mul_sa1(3, 4), 12);
  assert.equal(mul_sa1(0, 5), 0);
  assert.equal(mul_sa1(-2, 3), -6);
  assert.equal(mul_sa1(-2, -3), 6);
  assert.equal(mul_sa1(2.5, 4), 10);
});
