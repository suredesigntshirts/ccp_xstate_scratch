import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFreeze, checkSessions, checkVerdict, contract, findStubs, namedItem, sessionOf } from '../lib.mjs';

const item = (head, brief = 'Run it.') => `\`\`\`json\n${JSON.stringify(head, null, 2)}\n\`\`\`\n\nWhy.\n\n## Verifier brief\n\n${brief}\n`;
const head = {
  id: 'x', status: 'ready',
  expect: [{ id: 'a', proof: 'world' }, { id: 'b', proof: 'builder' }],
};
const met = (id, extra = {}) => ({ id, status: 'MET', command: 'npm test', excerpt: 'pass 3', ...extra });
const full = { item: 'x', results: [met('a'), met('b', { mutation: 'return 0', red_test: 'adds' })] };

test('a complete verdict passes', () => {
  assert.deepEqual(checkVerdict({ item: 'x', head, verdict: full }), []);
});

test('a missing verdict, a missing id, a NOT MET line and a bare builder line each fail', () => {
  assert.match(checkVerdict({ item: 'x', head, verdict: null })[0], /no verify\/x\/verdict.json/);
  assert.match(checkVerdict({ item: 'x', head, verdict: { item: 'x', results: [full.results[1]] } })[0], /no result for Expect a/);
  assert.match(checkVerdict({ item: 'x', head, verdict: { item: 'x', results: [{ ...met('a'), status: 'NOT MET' }, full.results[1]] } })[0], /a is NOT MET/);
  assert.match(checkVerdict({ item: 'x', head, verdict: { item: 'x', results: [met('a'), met('b')] } })[0], /b is builder-proven/);
  assert.match(checkVerdict({ item: 'x', head, verdict: { item: 'x', results: [met('a', { excerpt: ' ' }), full.results[1]] } })[0], /no output excerpt/);
  assert.match(checkVerdict({ item: 'x', head, verdict: { ...full, item: 'y' } })[0], /for item y/);
});

test('the contract ignores status but sees the head and the Verifier brief', () => {
  assert.equal(contract(item(head)), contract(item({ ...head, status: 'done' })));
  assert.notEqual(contract(item(head)), contract(item({ ...head, expect: [head.expect[0]] })));
  assert.notEqual(contract(item(head)), contract(item(head, 'Skim it.')));
});

test('the freeze refuses a changed contract unless the PR is a plan-only replan', () => {
  const frozen = [{ id: 'x', before: item(head), after: item({ ...head, expect: [head.expect[0]] }) }];
  const changed = ['plan/items/x.md', 'packages/a/index.js'];
  assert.match(checkFreeze({ changed, frozen, labels: [] })[0], /changes the contract of x/);
  assert.match(checkFreeze({ changed, frozen, labels: ['replan'] })[0], /touches packages\/a\/index.js/);
  assert.deepEqual(checkFreeze({ changed: ['plan/items/x.md'], frozen, labels: ['replan'] }), []);
  assert.deepEqual(checkFreeze({ changed, frozen: [{ id: 'x', before: item(head), after: item({ ...head, status: 'done' }) }], labels: [] }), []);
});

test('a PR names its item by body line or branch', () => {
  const ids = new Set(['x', 'y']);
  assert.equal(namedItem({ branch: 'build/x', body: '', ids }).item, 'x');
  assert.equal(namedItem({ branch: 'claude/thread-1', body: 'Builds it.\nItem: y\n', ids }).item, 'y');
  assert.equal(namedItem({ branch: 'chore/z', body: '', ids }).item, null);
  assert.match(namedItem({ branch: 'build/x', body: 'Item: y', ids }).reasons[0], /body names y but the branch names x/);
  assert.match(namedItem({ branch: 'a', body: 'Item: q', ids }).reasons[0], /doesn't have/);
});

test('the verdict session must differ from every builder session', () => {
  const s = (n) => `msg\n\nClaude-Session: https://claude.ai/code/session_${n}\n`;
  assert.equal(sessionOf(s(1)), 'https://claude.ai/code/session_1');
  const builder = [{ sha: 'b1b1b1b1', message: s(1), files: ['a.js'] }];
  assert.deepEqual(checkSessions({ item: 'x', verdictCommit: { sha: 'v', message: s(2) }, builderCommits: builder, afterVerified: [] }), []);
  assert.match(checkSessions({ item: 'x', verdictCommit: { sha: 'v', message: s(1) }, builderCommits: builder, afterVerified: [] })[0], /same Claude-Session as builder commit b1b1b1b/);
  assert.match(checkSessions({ item: 'x', verdictCommit: { sha: 'vvvvvvv', message: 'no trailer' }, builderCommits: builder, afterVerified: [] })[0], /no Claude-Session/);
  assert.match(checkSessions({ item: 'x', verdictCommit: { sha: 'v', message: s(2) }, builderCommits: builder, afterVerified: builder })[0], /changes a.js after the verified sha/);
});

test('the stub ban finds markers and skipped tests only under packages/ and plugins/', () => {
  const files = [
    { path: 'packages/a/x.js', text: 'ok\n// TODO later' },
    { path: 'plugins/p/y.js', text: "throw new Error('Not implemented')" },
    { path: 'packages/a/test/z.test.js', text: "test.skip('later', () => {})" },
    { path: 'packages/a/test/w.test.js', text: "test('later', { skip: true }, () => {})" },
    { path: 'packages/a/test/v.test.js', text: "test('later', (t) => { t.skip('no') })" },
    { path: 'scripts/s.js', text: '// TODO fine here' },
    { path: 'packages/a/clean.js', text: 'export const todos = []; // a list of todo items' },
  ];
  assert.deepEqual(findStubs(files), [
    'packages/a/x.js:2 has TODO',
    'plugins/p/y.js:1 has "not implemented"',
    'packages/a/test/z.test.js:1 has a skipped test',
    'packages/a/test/w.test.js:1 has a skipped test',
    'packages/a/test/v.test.js:1 has a skipped test',
  ]);
});
