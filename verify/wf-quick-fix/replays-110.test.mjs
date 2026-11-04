// Verifier's own replay of the journal #110's real headless run recorded (fixture 110-demo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { machineOf, replay, hashOf } from '../../packages/engine/src/index.js';

const spec = JSON.parse(readFileSync(new URL('../../workflows/quick-fix.json', import.meta.url), 'utf8'));
const entries = readFileSync(new URL('../../packages/engine/test/fixtures/110-demo/journal.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

test('replays-110: every recorded hash matches and the item ends done with the merge sha out.log shows', () => {
  assert.equal(entries.length, 6);
  assert.ok(entries.every((e) => e.hash), 'every entry carries #110\'s hash');
  const s = replay(spec, entries);
  assert.equal(s.value, 'done'); assert.equal(s.status, 'done');
  assert.equal(s.output.merge.sha, '1ede79999083998a5b74e17feb9ff23ccefe8b65');
  assert.equal(s.output.verdict.result, 'PASS');
  assert.equal(s.output.pr.headSha, '53eb9a6af6711c985cd23fa9ec91276ed4329f3e');
  assert.equal(s.output.verdict.sha, s.output.pr.headSha);
  assert.equal(hashOf(s), entries.at(-1).hash);
});

test('replays-110: a changed target is refused by replay', () => {
  const bad = structuredClone(spec);
  bad.states.verifying.invoke.onDone[0].target = 'replanning';
  assert.throws(() => replay(bad, entries), /the workflow changed|replays to/);
});

test('replays-110: a changed journal entry is refused by replay', () => {
  const bad = structuredClone(entries);
  bad[3].event.output.result = 'FAIL';
  assert.throws(() => replay(spec, bad), /replays to/);
});
