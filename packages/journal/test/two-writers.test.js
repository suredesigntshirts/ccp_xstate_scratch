// Two processes appending to one file at once leave whole lines, and both writers' rows read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from '../src/index.js';

const index = new URL('../src/index.js', import.meta.url).href;

const writer = (path, session, n) => new Promise((resolve, reject) => {
  const script = `
    import { append } from ${JSON.stringify(index)};
    for (let i = 0; i < ${n}; i++) {
      append(${JSON.stringify(path)}, { kind: 'tool.call', source: { system: 'test', ref: String(i) },
        session: ${JSON.stringify(session)}, release: '0.1.0', payload: { i, pad: 'x'.repeat(500) } });
    }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit' });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${session} exited ${code}`))));
});

test('two writers at once never tear a line', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'journal-')), 'shared.jsonl');
  await Promise.all([writer(path, 'a', 100), writer(path, 'b', 100)]);
  const { rows, bad } = readFile(path);
  assert.deepEqual(bad, []);
  assert.equal(readFileSync(path, 'utf8').split('\n').filter(Boolean).length, 200);
  for (const session of ['a', 'b']) {
    assert.deepEqual(rows.filter((r) => r.session === session).map((r) => r.payload.i), [...Array(100).keys()]);
  }
});
