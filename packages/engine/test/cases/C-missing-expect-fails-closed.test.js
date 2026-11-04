// C-missing-expect-fails-closed (plan/cases/work-item.md): an item with no Expect lines can't leave queued (here:
// can't start), and the refusal names the missing input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRefusal } from '../../src/index.js';
import { ISSUE, workflow } from '../flow.js';

test('C-missing-expect-fails-closed: an issue with no expect field is refused, naming expect', () => {
  assert.match(startRefusal(workflow, { issue: { url: ISSUE.url } }), /expect is missing/);
});

test('C-missing-expect-fails-closed: an issue with an empty expect list is refused, naming expect', () => {
  assert.match(startRefusal(workflow, { issue: { ...ISSUE, expect: [] } }), /expect has fewer than 1 items/);
});

test('C-missing-expect-fails-closed: with the input schema gone, the first state\'s needs still refuse it', () => {
  const noSchema = { ...workflow, meta: { ...workflow.meta, input: {} } };
  assert.equal(startRefusal(noSchema, { issue: { url: ISSUE.url } }), 'the initial state needs hasIssue');
});

test('C-missing-expect-fails-closed: an issue with Expect lines starts (the control)', () => {
  assert.equal(startRefusal(workflow, { issue: ISSUE }), null);
});
