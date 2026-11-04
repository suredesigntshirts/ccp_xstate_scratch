// F2: the feature parent is restored on another host mid-slice: no slice is started twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pump } from '../../src/effects/index.js';
import { makeWorld, BRIEFS, pending, suiteWake, RELEASE } from './world.js';

const GOAL = { url: 'https://github.com/o/r/issues/9', expect: ['add exists', 'multiply exists', 'divide exists'] };
const SLICES = [1, 2, 3].map((i) => ({ url: `${GOAL.url}#s${i}`, expect: [GOAL.expect[i - 1]] }));
const BRANCH = 'feature/9-math';
const inits = (w, id) => w.rows(id).filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'applied' && r.payload.seq === 0).length;
const briefRuns = (w, id) => w.rows(id).filter((r) => r.kind === 'brief.stored' && r.payload.actor === 'brief' && r.payload.worktree).length;

async function toPlanned(w) {
  await w.start('f2', 'feature', { issue: GOAL, branch: BRANCH });
  assert.ok((await w.agent('f2', 'brief', () => ({ slices: SLICES }))).accepted);
}

test('F2 (a): a host restored in a new process, mid-slice, starts no slice again', async () => {
  const w = await makeWorld();
  try {
    await toPlanned(w);
    await w.drive('f2');
    const kids = pending(w.host('f2')).runs.map((r) => r.id).sort();
    assert.equal(kids.length, 3);
    for (const k of kids) assert.equal(w.host(k).snapshot.value, 'briefing');
    // s1 gets on a bit, so the restore happens mid-slice.
    assert.ok((await w.agent(kids[0], 'brief', () => BRIEFS)).accepted);
    // New process: everything restored from the journal, offered nothing new, then a wake for everyone.
    await w.drive('f2');
    await w.drive('f2', suiteWake('e'.repeat(40), 99));
    for (const k of kids) {
      assert.equal(inits(w, k), 1, `${k}: one seq-0 row`);
      assert.equal(briefRuns(w, k), 1, `${k}: one brief run prepared`);
    }
    assert.equal(w.host(kids[0]).snapshot.value, 'building');
    assert.equal(pending(w.host('f2')).runs.length, 3, 'the parent still waits on the same three children');
  } finally {
    await w.close();
  }
});

test('F2 (b): a host that stopped mid-start of s2 (start row, no end) finds the child on restore and does not start it again', async () => {
  const w = await makeWorld();
  try {
    await toPlanned(w);
    // The first host dies inside s2's start, after the child item was made and before the effect's end row.
    let made;
    const childMade = new Promise((ok) => { made = ok; });
    const crashing = (host) => {
      const h = w.handlersFor(host);
      return { ...h, run: { ...h.run, start: async (effect) => {
        const out = await h.run.start(effect);
        if (effect.invoke === 's2') { made(); return new Promise(() => {}); } // never returns: the process is gone
        return out;
      } } };
    };
    pump({ root: w.root, top: 'f2', session: w.session, release: RELEASE, handlersFor: crashing }); // not awaited: it dies
    await childMade;
    const parentRows = w.rows('f2').filter((r) => r.kind === 'engine.effect');
    const s2 = parentRows.find((r) => r.payload.effect.endsWith('.s2')).payload.effect;
    assert.deepEqual(parentRows.filter((r) => r.payload.effect === s2).map((r) => r.payload.phase), ['start'], 's2: started, never ended');
    assert.equal(inits(w, s2), 1);
    // A new host restores the parent and carries on.
    await w.drive('f2');
    assert.deepEqual(w.rows('f2').filter((r) => r.kind === 'engine.effect' && r.payload.effect === s2).map((r) => r.payload.phase), ['start', 'done'], 'found, not started again');
    const kids = pending(w.host('f2')).runs.map((r) => r.id).sort();
    assert.equal(kids.length, 3);
    for (const k of kids) {
      assert.equal(inits(w, k), 1, `${k}: one seq-0 row`);
      assert.equal(briefRuns(w, k), 1, `${k}: one brief run`);
    }
  } finally {
    await w.close();
  }
});

test('F2 (c): another session restoring the parent and offering a wake is not the owner and starts nothing', async () => {
  const w = await makeWorld();
  try {
    await toPlanned(w);
    await w.drive('f2');
    const kids = pending(w.host('f2')).runs.map((r) => r.id).sort();
    const before = kids.map((k) => w.rows(k).length);
    const got = await pump({ root: w.root, top: 'f2', session: 'other', release: RELEASE, handlersFor: w.handlersFor,
      inputsFor: () => [{ event: { type: 'xstate.done.actor.s1', output: { issue: SLICES[0] } }, run: kids[0], source: { system: 'item', ref: 'forged' } }] });
    assert.ok(got.length > 0 && got.every((r) => r.outcome === 'not-owner'), JSON.stringify(got.map((r) => r.outcome)));
    assert.deepEqual(kids.map((k) => w.rows(k).length), before, 'nothing written to the children');
    for (const k of kids) assert.equal(inits(w, k), 1);
  } finally {
    await w.close();
  }
});
