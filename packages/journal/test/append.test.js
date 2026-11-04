// append() writes one valid row per line to one known file and refuses what it shouldn't write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append, compareReleases, JournalError, OlderWriterError, readFile, MAX_LINE_BYTES } from '../src/index.js';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'journal-')), 'session.jsonl');

const input = (over = {}) => ({
  kind: 'tool.call',
  source: { system: 'claude-code', ref: 'toolu_01' },
  session: 'session_01',
  release: '0.1.0',
  payload: { tool: 'Bash' },
  ...over,
});

test('append stamps v, id and at and writes one line', () => {
  const path = fresh();
  const row = append(path, input());
  assert.equal(row.v, 1);
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  assert.match(row.at, /Z$/);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), row);
});

test('append keeps a given id and at', () => {
  const row = append(fresh(), input({ id: 'call-7', at: '2026-10-30T10:00:00.000Z' }));
  assert.equal(row.id, 'call-7');
  assert.equal(row.at, '2026-10-30T10:00:00.000Z');
});

test('append refuses an invalid row, an unknown kind and another version', () => {
  const path = fresh();
  assert.throws(() => append(path, input({ source: undefined })), /row.source must be object/);
  assert.throws(() => append(path, input({ kind: 'engine.unknown' })), /unknown kind engine.unknown/);
  assert.throws(() => append(path, input({ v: 2 })), /writes v1 rows, not v2/);
  assert.throws(() => append(path, input({ payload: { big: 'x'.repeat(MAX_LINE_BYTES) } })), /byte limit/);
});

test('rows append in order', () => {
  const path = fresh();
  for (let i = 0; i < 5; i++) append(path, input({ payload: { i } }));
  assert.deepEqual(readFile(path).rows.map((r) => r.payload.i), [0, 1, 2, 3, 4]);
});

test('compareReleases orders x.y.z numerically', () => {
  assert.ok(compareReleases('0.9.0', '0.10.0') < 0);
  assert.ok(compareReleases('1.0.0', '0.99.99') > 0);
  assert.equal(compareReleases('1.2.3', '1.2.3'), 0);
});

test('a writer older than the newest row is refused, naming both releases', () => {
  const path = fresh();
  append(path, input({ release: '0.2.0' }));
  assert.throws(() => append(path, input({ release: '0.1.9' })), (error) => {
    assert.ok(error instanceof OlderWriterError && error instanceof JournalError);
    assert.match(error.message, /release 0\.1\.9 is older than release 0\.2\.0/);
    assert.deepEqual([error.writer, error.newest], ['0.1.9', '0.2.0']);
    return true;
  });
  assert.equal(readFile(path).rows.length, 1);
});

test('the same or a newer release may append', () => {
  const path = fresh();
  append(path, input({ release: '0.2.0' }));
  append(path, input({ release: '0.2.0' }));
  append(path, input({ release: '0.3.0' }));
  assert.throws(() => append(path, input({ release: '0.2.0' })), /older than release 0\.3\.0/);
});

test('the newest release is found past a torn last line and a long tail', () => {
  const path = fresh();
  append(path, input({ release: '0.5.0', payload: { pad: 'x'.repeat(200 * 1024) } }));
  writeFileSync(path, '{"torn', { flag: 'a' });
  assert.throws(() => append(path, input({ release: '0.4.0' })), /older than release 0\.5\.0/);
});
