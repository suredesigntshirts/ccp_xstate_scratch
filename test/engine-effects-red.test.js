import { test } from 'node:test';
import assert from 'node:assert/strict';
test('engine-effects deliberately failing check', () => assert.equal(1, 2));
