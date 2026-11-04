// Every kind's row validates against row.schema.json, and a row missing its source or version fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, VERSION, validate } from '../src/index.js';

const row = (kind) => ({
  v: VERSION,
  id: `row-${kind}`,
  at: '2026-10-30T10:00:00.000Z',
  kind,
  source: { system: 'claude-code', ref: 'toolu_01' },
  session: 'https://claude.ai/code/session_01',
  agent: null,
  item: 'journal-schema',
  state: null,
  release: '0.1.0',
  payload: {},
});

const without = (field) => {
  const r = row('tool.call');
  delete r[field];
  return r;
};

test('a row of every kind validates', () => {
  for (const kind of KINDS) assert.deepEqual(validate(row(kind)), [], kind);
});

test('a row missing source fails', () => {
  assert.deepEqual(validate(without('source')), ['row is missing source']);
});

test('a row missing v fails', () => {
  assert.deepEqual(validate(without('v')), ['row is missing v']);
});

test('every required field is required', () => {
  for (const field of ['id', 'at', 'kind', 'session', 'release', 'payload']) {
    assert.deepEqual(validate(without(field)), [`row is missing ${field}`], field);
  }
});

test('optional fields may be left out', () => {
  const r = row('agent.spawn');
  for (const field of ['agent', 'item', 'state']) delete r[field];
  assert.deepEqual(validate(r), []);
});

test('a source needs both system and ref', () => {
  assert.deepEqual(validate({ ...row('ci.result'), source: { system: 'github' } }), ['row.source is missing ref']);
  assert.deepEqual(validate({ ...row('ci.result'), source: { system: '', ref: 'x' } }),
    ['row.source.system must not be empty']);
});

test('bad shapes fail with a reason', () => {
  assert.match(validate({ ...row('refusal'), v: 0 })[0], /row.v must be at least 1/);
  assert.match(validate({ ...row('refusal'), v: '1' })[0], /row.v must be integer/);
  assert.match(validate({ ...row('refusal'), at: '2026-10-30' })[0], /row.at must match/);
  assert.match(validate({ ...row('refusal'), release: 'v1' })[0], /row.release must match/);
  assert.match(validate({ ...row('refusal'), kind: 'Tool Call' })[0], /row.kind must match/);
  assert.match(validate({ ...row('refusal'), payload: [] })[0], /row.payload must be object/);
  assert.match(validate({ ...row('refusal'), extra: 1 })[0], /unknown field extra/);
});

test('a placeholder row says why', () => {
  assert.deepEqual(validate({ ...row('turn.usage'), placeholder: 'usage missing from the transcript' }), []);
  assert.match(validate({ ...row('turn.usage'), placeholder: '' })[0], /must not be empty/);
});

test('docs/journal.md lists exactly the kinds a writer may append', () => {
  const doc = readFileSync(new URL('../../../docs/journal.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('## Kinds'), doc.indexOf('## Adding a kind'));
  const listed = [...section.matchAll(/^\| `([a-z._]+)` \| /gm)].map((m) => m[1]);
  assert.deepEqual(listed.toSorted(), [...KINDS].toSorted());
});
