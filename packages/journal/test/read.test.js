// Reading: one known file, upcast on read, never rewritten; bad lines are counted with a reason, not dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append, readAll, readFile, upcast } from '../src/index.js';

const base = (over = {}) => ({
  v: 1,
  id: 'r1',
  at: '2026-10-30T10:00:00.000Z',
  kind: 'person.message',
  source: { system: 'hearth', ref: 'cmsg_1' },
  session: 's',
  release: '0.1.0',
  payload: {},
  ...over,
});

const dir = () => mkdtempSync(join(tmpdir(), 'journal-'));

test('readFile returns rows in time order', () => {
  const path = join(dir(), 'a.jsonl');
  writeFileSync(path, [base({ id: 'late', at: '2026-10-30T10:00:02.000Z' }), base({ id: 'early' })]
    .map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.deepEqual(readFile(path).rows.map((r) => r.id), ['early', 'late']);
});

test('torn, versionless, newer and invalid lines are counted with a reason', () => {
  const path = join(dir(), 'a.jsonl');
  const { v, ...noV } = base();
  writeFileSync(path, [
    JSON.stringify(base()),
    '{"v":1,"id":"to',
    JSON.stringify(noV),
    JSON.stringify(base({ v: 2 })),
    JSON.stringify(base({ source: undefined })),
  ].join('\n') + '\n');
  const { rows, bad } = readFile(path);
  assert.equal(rows.length, 1);
  assert.deepEqual(bad.map((b) => [b.line, b.reason]), [
    [2, 'not JSON (a torn or partial line)'],
    [3, 'no version (v)'],
    [4, "row is v2, newer than this reader's v1"],
    [5, 'row is missing source'],
  ]);
});

test('an older row is upcast on read and the file is left as it was', () => {
  const path = join(dir(), 'a.jsonl');
  const old = JSON.stringify({ ...base(), v: 1, payload: { text: 'hi' } });
  writeFileSync(path, `${old}\n`);
  // A reader at a future v2 whose upcaster moves payload.text to payload.body.
  const upcasters = { 1: (row) => ({ ...row, payload: { body: row.payload.text } }) };
  const { rows, bad } = readFile(path, { version: 2, upcasters });
  assert.deepEqual(bad, []);
  assert.equal(rows[0].v, 2);
  assert.deepEqual(rows[0].payload, { body: 'hi' });
  assert.equal(readFileSync(path, 'utf8'), `${old}\n`);
});

test('a missing upcaster is reported, not guessed', () => {
  assert.throws(() => upcast(base(), { version: 2, upcasters: {} }), /no upcaster from v1 to v2/);
});

test('readAll merges every journal under a root in time order', () => {
  const root = dir();
  mkdirSync(join(root, 'items'));
  const row = { kind: 'ci.result', source: { system: 'github', ref: 'run-1' }, session: 's', release: '0.1.0', payload: {} };
  append(join(root, 'session-a.jsonl'), { ...row, id: 'a1', at: '2026-10-30T10:00:01.000Z' });
  append(join(root, 'items', 'item.jsonl'), { ...row, id: 'i1', at: '2026-10-30T10:00:00.000Z' });
  append(join(root, 'session-a.jsonl'), { ...row, id: 'a2', at: '2026-10-30T10:00:02.000Z' });
  writeFileSync(join(root, 'notes.txt'), 'not a journal');
  const { files, rows, bad } = readAll(root);
  assert.equal(files.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ['i1', 'a1', 'a2']);
  assert.deepEqual(bad, []);
});
