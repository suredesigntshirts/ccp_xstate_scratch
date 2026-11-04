// Verifier checks for repo-skeleton: CLAUDE.md is short, names real paths, and states the branch rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const text = readFileSync(new URL('CLAUDE.md', root), 'utf8');

test('CLAUDE.md is under 100 lines', () => {
  assert.ok(text.split('\n').length - 1 < 100);
});

test('every path CLAUDE.md names in backticks exists', () => {
  const placeholder = /[<>]|^(build|probe|replan|chore|claude)\//;
  const paths = [...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1])
    .filter((p) => /\/|\.(md|mjs|yml)$/.test(p) && !placeholder.test(p) && p !== 'docs/<topic>');
  assert.ok(paths.length >= 10);
  const missing = paths.filter((p) => !existsSync(new URL(p, root)));
  assert.deepEqual(missing, []);
});

test('CLAUDE.md gives the branch convention and no claude/ prefix', () => {
  assert.match(text, /<kind>\/<item-id>/);
  assert.match(text, /No `claude\/` prefix/);
});
