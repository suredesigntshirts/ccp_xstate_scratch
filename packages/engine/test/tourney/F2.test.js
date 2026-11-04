// F2 the parent is restored on another host mid-slice: no slice is started twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { itemWorld, offer, startEvent, briefReturns, builderReturns, verifierReturns, deliver, wake, checkSuite, openRun, rows, resultsOf, pending } from './world.js';
import { runDir } from '../../src/actors.js';

const ISSUE = { url: 'https://github.com/o/r/issues/8', expect: ['math.js exports add, sub and mul'] };
const BRIEFS = { builder: 'Build the slice named by your input.', verifier: 'Check the slice.', slices: ['add', 'sub', 'mul'], count: 3 };

// The real handlers, with every run start counted; `hang(effect)` makes a start never finish after it really ran
// (the host process dies there, after its start row is persisted and the run folder is written).
function counted(w, host, starts, hang = () => false) {
  const real = w.handlersFor(host);
  return {
    ...real,
    run: {
      ...real.run,
      start: async (effect) => {
        starts.push({ host: host.session, id: effect.id, actor: effect.actor });
        const out = await real.run.start(effect);
        if (hang(effect)) return new Promise(() => {});
        return out;
      }
    }
  };
}

test('F2: a host restored mid-slice finds the slice\'s build run instead of starting it again; another session starts nothing', async () => {
  const w = await itemWorld({ workflow: 'feature' });
  try {
    const starts = [];
    w.handlers = counted(w, w.host, starts, (e) => e.actor === 'build' && e.input?.slice === 1);
    await offer(w.host, [startEvent({ issue: ISSUE })], w.handlers);
    await briefReturns(w, BRIEFS);
    await builderReturns(w);
    await deliver(w);
    await verifierReturns(w);
    // Host A merges slice 0 and starts slice 1's build, then dies inside that start.
    deliver(w);
    let slice1 = null;
    for (let i = 0; i < 200 && !slice1; i++) {
      await new Promise((ok) => setTimeout(ok, 25));
      slice1 = starts.find((s) => s.actor === 'build' && s.id !== starts.find((x) => x.actor === 'build').id);
      if (slice1 && !existsSync(join(runDir(w.root, slice1.id), 'run.json'))) slice1 = null;
    }
    assert.ok(slice1, 'host A started slice 1\'s build');
    const startRows = rows(w.root).filter((r) => r.kind === 'engine.effect' && r.payload.effect === slice1.id);
    assert.deepEqual(startRows.map((r) => r.payload.phase), ['start'], 'A persisted the start and never the end');

    // Host B: the same owner session, restored from the journal on another machine.
    const hostB = w.open();
    assert.equal(hostB.snapshot.value, 'building');
    assert.equal(hostB.snapshot.context.cursor.slice, 1);
    w.host = hostB;
    w.handlers = counted(w, hostB, starts);
    await offer(hostB, [], w.handlers);
    assert.equal(starts.filter((s) => s.id === slice1.id).length, 1, 'slice 1\'s build was started once, by A');
    const ends = rows(w.root).filter((r) => r.kind === 'engine.effect' && r.payload.effect === slice1.id);
    assert.deepEqual(ends.map((r) => [r.session, r.payload.phase]), [['owner', 'start'], ['owner', 'done']]);
    assert.equal(ends[1].payload.outcome.found, true);
    assert.equal(rows(w.root).filter((r) => r.kind === 'brief.stored' && r.payload.run === slice1.id).length, 1, 'one run folder, one brief');

    // Host C: another session. It starts nothing and is turned away.
    const hostC = w.open('other');
    const cStarts = [];
    const results = await offer(hostC, [...resultsOf(hostC)], counted(w, hostC, cStarts));
    assert.deepEqual(cStarts, []);
    const [pushed] = await offer(hostC, [{ event: { type: 'github.check_suite.completed', head_sha: 'a'.repeat(40), pr: 'o/r#2' }, source: { system: 'github', ref: 'cs1' } }], counted(w, hostC, cStarts));
    assert.equal(pushed.outcome, 'not-owner');
    assert.deepEqual(cStarts, []);
    assert.ok(results.every((r) => r.outcome === 'not-owner'));

    // The slice's builder returns; B takes it to verifying, and the slice is not built again.
    const b = await builderReturns(w);
    assert.ok(b.got.accepted, JSON.stringify(b.got));
    assert.equal(b.agent.run.run, slice1.id);
    await deliver(w);
    assert.equal(hostB.snapshot.value, 'verifying');
    assert.equal(starts.filter((s) => s.actor === 'build').length, 2, 'two builds in all: slice 0 and slice 1, each once');
    assert.equal(pending(hostB).runs.filter((r) => r.actor === 'build').length, 0);
  } finally {
    await w.close();
  }
});
