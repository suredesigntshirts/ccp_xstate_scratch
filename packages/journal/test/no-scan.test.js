// append() is safe on a hook path: it opens exactly one file and lists no folder (ledger L-library-mount-slow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append } from '../src/index.js';

// Wraps every function of node:fs so each call is counted by name.
function countingFs() {
  const calls = [];
  const stub = new Proxy(fs, {
    get(target, name) {
      const value = target[name];
      if (typeof value !== 'function') return value;
      return (...args) => {
        calls.push({ name, args });
        return value.apply(target, args);
      };
    },
  });
  return { stub, calls };
}

const row = { kind: 'hook.run', source: { system: 'hook', ref: 'PreToolUse' }, session: 's', release: '0.1.0', payload: {} };

test('append opens exactly one file and lists no folder', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'journal-')), 'session.jsonl');
  for (const round of [1, 2]) {
    const { stub, calls } = countingFs();
    append(path, row, { fs: stub });
    const opens = calls.filter((c) => /^open|Stream$|File/.test(c.name));
    assert.deepEqual(opens.map((c) => [c.name, c.args[0]]), [['openSync', path]], `round ${round}`);
    assert.deepEqual(calls.filter((c) => /dir|glob/i.test(c.name)), [], `round ${round}`);
    // Every other call works on the one open descriptor: nothing else is named by path.
    assert.deepEqual([...new Set(calls.map((c) => c.name))].sort(),
      (round === 1 ? ['closeSync', 'fstatSync', 'openSync', 'writeSync'] : ['closeSync', 'fstatSync', 'openSync', 'readSync', 'writeSync']),
      `round ${round}`);
  }
});
