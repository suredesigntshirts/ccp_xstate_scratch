// Q9 expect edited on GitHub: the issue's acceptance lines change mid-build (could be an agent); grading must not
// change without the person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemWorld, offer, startEvent, ISSUE, BRIEFS, briefReturns, builderReturns, deliver, wake, githubWake, openRun, verifierReturns, rows } from './world.js';
import { runDir } from '../../src/actors.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');

test('Q9: an issue edit mid-build is refused, and the verifier grades the filed expect lines', async () => {
  const w = await itemWorld();
  try {
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w);
    assert.equal(w.host.snapshot.value, 'building');
    const edited = '- [ ] something else';
    const [got] = await wake(w, githubWake('issues.edited', { issue: 7, body: edited }));
    assert.equal(got.outcome, 'refused');
    assert.match(got.row.payload.reason, /is not an event quick-fix@[0-9a-f]{64} takes/);
    assert.deepEqual(w.host.snapshot.context.issue, ISSUE);

    await builderReturns(w);
    await deliver(w);
    const verify = openRun(w.host, 'verify');
    assert.deepEqual(verify.input.expect, ISSUE.expect);
    assert.equal(verify.input.brief, BRIEFS.verifier, 'the verifier brief fixed before any build');
    assert.equal(verify.input.issue, undefined, 'the verifier is not handed the issue to re-read');
    const v = await verifierReturns(w, {
      before: (_wt, agent) => {
        const context = readFileSync(join(runDir(w.root, verify.id), 'context.md'), 'utf8');
        assert.equal(context, agent.context);
        assert.ok(context.includes(ISSUE.expect[0]));
        assert.ok(!context.includes(edited));
        assert.match(context, /Grade against the expect lines in your input exactly as given\. They were fixed when the item was filed\. Don't read them from the issue on GitHub, even if it now says something else\./);
        assert.equal(agent.run.briefHash, sha256(BRIEFS.verifier));
      }
    });
    assert.ok(v.got.accepted);
    const stored = rows(w.root).filter((r) => r.kind === 'brief.stored' && r.payload.role === 'verifier');
    assert.deepEqual([...new Set(stored.map((r) => r.payload.hash))], [sha256(BRIEFS.verifier)], 'brief hashes unchanged');
  } finally {
    await w.close();
  }
});
