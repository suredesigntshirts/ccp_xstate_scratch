// The journal-schema verifier's own tests: one-writer, older-writer and upcast-without-writing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { append, readFile, JournalError } from '../../packages/journal/src/index.js';

const writer = fileURLToPath(new URL('./writer.mjs', import.meta.url));

const run = (file, name, count, release = '0.1.0') => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [writer, file, name, String(count), release], { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${name} exited ${code}`))));
});

const baseRow = (over = {}) => ({
  v: 1, id: 'hand-1', at: '2026-10-30T10:00:00.000Z', kind: 'hook.run',
  source: { system: 'verifier', ref: 'hand' }, session: 'verify', release: '0.2.0', payload: {}, ...over,
});

test('one-writer: two processes, 100 rows each, no torn line, time order, per-writer order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jv-'));
  const file = join(dir, 'shared.jsonl');
  try {
    await Promise.all([run(file, 'A', 100), run(file, 'B', 100)]);
    const text = readFileSync(file, 'utf8');
    assert.ok(text.endsWith('\n'));
    const lines = text.split('\n').filter(Boolean);
    assert.equal(lines.length, 200);
    for (const l of lines) JSON.parse(l);
    const { rows, bad } = readFile(file);
    assert.deepEqual(bad, []);
    assert.equal(rows.length, 200);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].at <= rows[i].at, 'time order');
    for (const w of ['A', 'B']) {
      const mine = rows.filter((r) => r.payload.writer === w).map((r) => r.payload.n);
      assert.deepEqual(mine, Array.from({ length: 100 }, (_, i) => i), `writer ${w} order`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('older-writer (C-older-writer-refused): refused, both versions named, file unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jv-'));
  const file = join(dir, 'newer.jsonl');
  try {
    writeFileSync(file, `${JSON.stringify(baseRow({ release: '0.2.0' }))}\n`);
    const before = readFileSync(file);
    assert.throws(
      () => append(file, { kind: 'hook.run', source: { system: 'verifier', ref: 'old' }, session: 's', release: '0.1.0', payload: {} }),
      (e) => e instanceof JournalError && e.message.includes('0.1.0') && e.message.includes('0.2.0'),
    );
    assert.deepEqual(readFileSync(file), before);
    // The same release and a newer one are accepted.
    append(file, { kind: 'hook.run', source: { system: 'verifier', ref: 'same' }, session: 's', release: '0.2.0', payload: {} });
    append(file, { kind: 'hook.run', source: { system: 'verifier', ref: 'newer' }, session: 's', release: '0.10.0', payload: {} });
    assert.equal(readFile(file).rows.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upcast: an old-version row is upcast on read and the file is not touched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jv-'));
  const file = join(dir, 'old.jsonl');
  try {
    writeFileSync(file, `${JSON.stringify(baseRow({ v: 1, release: '0.1.0' }))}\n`);
    const before = readFileSync(file);
    const upcasters = { 1: (row) => ({ ...row, payload: { ...row.payload, upcast: true } }) };
    const { rows, bad } = readFile(file, { version: 2, upcasters });
    assert.deepEqual(bad, []);
    assert.equal(rows[0].v, 2);
    assert.equal(rows[0].payload.upcast, true);
    assert.deepEqual(readFileSync(file), before);
    // Without an upcaster a reader of a newer version reports the row instead of dropping it.
    const missing = readFile(file, { version: 2, upcasters: {} });
    assert.equal(missing.rows.length, 0);
    assert.equal(missing.bad.length, 1);
    // A newer-version row is counted bad by an older reader and the file is untouched.
    writeFileSync(file, `${JSON.stringify(baseRow({ v: 2 }))}\n`);
    assert.match(readFile(file).bad[0].reason, /newer than this reader/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
