// F2 the parent is restored on another host mid-slice: no slice is started twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { actors, prepare } from '../../src/actors.js';
import { agents, fresh, ghInputs, gitRepo, handlers, loadWorkflow, offer, open, openRun, pending, prOf, rows, start } from './world-b.js';

const spec = loadWorkflow('feature');
const GOAL = { url: 'https://github.com/o/r/issues/9', expect: ['the CLI has a --json flag'] };
const FPR = prOf(10, '0'.repeat(40), 'feature/it-1');
const PLAN = { done: false, feature: FPR, builder: 'build slice 1', verifier: 'grade slice 1', expect: ['slice 1'] };

test('F2: a restored host starts no run again, and another session\'s host starts none and is turned away', async () => {
  const root = fresh('f2');
  const a = agents({ brief: [PLAN] }); // the build stays open: mid-slice
  const host = open(root, spec);
  await offer(host, [start({ goal: GOAL })], handlers({ actors: a.byActor }));
  assert.equal(host.snapshot.value, 'building');
  assert.equal(a.started.filter((e) => e.actor === 'build').length, 1);

  const b = agents({ brief: [PLAN], build: [null] });
  const again = open(root, spec); // the same owner, a fresh host object (the next wake)
  await offer(again, [], handlers({ actors: b.byActor }));
  assert.equal(again.snapshot.value, 'building');
  assert.equal(b.started.length, 0, 'the restored host starts no run');

  const other = open(root, spec, { session: 'other-host' });
  const [res] = await offer(other, ghInputs(other, 'check_suite.completed', { head_sha: 'a'.repeat(40) }), handlers({ actors: b.byActor }));
  assert.equal(res.outcome, 'not-owner');
  assert.equal(b.started.length, 0, 'the other host starts no run');
  const buildStarts = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'build' && r.payload.phase === 'start');
  assert.equal(buildStarts.length, 1, 'one build start in the journal');
});

test('F2 crash: the owner stops after a run\'s start row; the restored host finds the run and does not prepare it twice', async () => {
  const root = fresh('f2c');
  const repo = gitRepo();
  const worktrees = join(root, 'wt');
  const host = open(root, spec);
  const brief = agents({ brief: [PLAN] }).byActor.brief;
  // The build handler prepares the run, then the process dies before the effect's end row is written.
  const dying = { start: (effect) => { prepare({ host, effect, repo, worktrees }); return new Promise(() => {}); } };
  offer(host, [start({ goal: GOAL })], handlers({ actors: { brief, build: dying } })); // never settles: the crash
  await new Promise((ok) => setImmediate(ok));
  for (let i = 0; i < 50 && !rows(root).some((r) => r.kind === 'brief.stored' && /build/.test(r.payload.run)); i++) await new Promise((ok) => setTimeout(ok, 10));
  const buildEffect = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'build');
  assert.deepEqual(buildEffect.map((r) => r.payload.phase), ['start'], 'only the start row: the host stopped mid-effect');

  const restored = open(root, spec);
  await offer(restored, [], handlers({ actors: actors({ host: restored, repo, worktrees }) }));
  const after = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'build').map((r) => r.payload.phase);
  assert.deepEqual(after, ['start', 'done'], 'the restored host found the run (run.json) and ended the effect');
  assert.equal(rows(root).filter((r) => r.kind === 'brief.stored' && /build/.test(r.payload.run)).length, 1, 'the build run was prepared once');
  assert.ok(openRun(restored, 'build'), 'the build run is still open for its agent');
  assert.equal(pending(restored).runs.filter((r) => r.actor === 'build').length, 1);
});
