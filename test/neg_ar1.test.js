import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neg_ar1 } from '../src.js';

test('neg_ar1', () => {
  assert.equal(neg_ar1(3), -3);
  assert.equal(neg_ar1(-4), 4);
  assert.equal(neg_ar1(2.5), -2.5);
  assert.equal(Math.abs(neg_ar1(0)), 0);
});
