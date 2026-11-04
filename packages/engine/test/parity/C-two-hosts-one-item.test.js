// C-two-hosts-one-item (plan/cases/work-item.md): given an item owned by one thread, when another session's host
// receives an event for it, it doesn't apply it; the event is journalled as refused (not-owner), and no effect runs
// twice. Plan item fix-other-host-runs-effects: only the owner's host carries out the item's open effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  A, B, agents, checkWake, fresh, handlers, hostCli, inputsOfWakeFor, itemFile, offer, open, pending, platform,
  rows, sessionFile, sessionRows, start, timeWake
} from './world.js';
import { cardFile } from '../../src/effects/relay.js';

// Every effect type a host can start, each counting its starts: the real handlers over the stub thread and clock,
// wrapped so a start by any host is seen.
function counting({ plat = platform(), actors = {}, hearth = true } = {}) {
  const real = handlers({ github: null, hearth: hearth ? plat.hearth : null, clock: plat.clock, actors });
  const starts = [];
  const wrap = (type, h) => ({
    ...h,
    start: async (effect) => {
      starts.push({ type, id: effect.id, actor: effect.actor ?? null });
      return h?.start ? h.start(effect) : {};
    }
  });
  const out = Object.fromEntries(['run', 'stop', 'timer', 'cancel'].map((type) => [type, wrap(type, real[type] ?? {})]));
  return { handlers: out, starts, plat };
}

// The owner files the item and takes it to awaitingMerge with no thread client, so its card is left open.
async function ownedWithCardOpen() {
  const root = fresh();
  const owner = open(root, { session: 'owner' });
  const a = agents({ brief: [{ builder: 'b.md', verifier: 'v.md' }], build: [{ pr: { branch: 'build/x', headSha: A, url: 'https://github.com/o/r/pull/1' } }], verify: [{ result: 'PASS', sha: A, report: 'r' }] });
  await offer(owner, [start('owner')], handlers({ github: null, hearth: null, actors: a.byActor }));
  assert.equal(owner.snapshot.value, 'awaitingMerge');
  assert.equal(pending(owner).effects.filter((e) => e.actor === 'ask').length, 1, 'the card is open');
  return { root, a };
}

test('C-two-hosts-one-item: another session\'s host, offered a wake or nothing, starts none of the item\'s effects and writes nothing to its file', async () => {
  const { root, a } = await ownedWithCardOpen();
  const before = readFileSync(itemFile(root, 'it-1'), 'utf8');

  const other = open(root, { session: 'other' });
  assert.equal(other.owner, 'owner');
  const c = counting({ actors: a.byActor });
  const empty = await offer(other, [], c.handlers);
  assert.deepEqual(empty, []);
  const results = await offer(other, [
    ...inputsOfWakeFor(other, checkWake({ head: A })),
    ...inputsOfWakeFor(other, timeWake('2999-01-01T00:00:00Z')),
    { event: { type: 'pr.pushed', headSha: B }, source: { system: 'github', ref: 'p1' } }
  ], c.handlers);

  assert.ok(results.length >= 1);
  assert.ok(results.every((r) => r.outcome === 'not-owner'), JSON.stringify(results.map((r) => r.outcome)));
  assert.deepEqual(c.starts, [], 'no card, post, run, timer or merge started');
  assert.deepEqual(c.plat.cards, []);
  assert.equal(readFileSync(itemFile(root, 'it-1'), 'utf8'), before, 'the item\'s file is unchanged');
  const turned = sessionRows(root, 'other').filter((r) => r.kind === 'engine.transition');
  assert.equal(turned.length, results.length);
  assert.ok(turned.every((r) => r.payload.outcome === 'not-owner' && r.item === 'it-1'));
});

test('C-two-hosts-one-item: the owner\'s host still runs its open card once, after another session\'s host woke first', async () => {
  const { root, a } = await ownedWithCardOpen();
  const shared = platform();
  const other = open(root, { session: 'other' });
  await offer(other, [{ event: { type: 'pr.pushed', headSha: B }, source: { system: 'github', ref: 'p1' } }], counting({ plat: shared, actors: a.byActor }).handlers);
  assert.equal(shared.cards.length, 0);

  const back = open(root, { session: 'owner' });
  const c = counting({ plat: shared, actors: a.byActor });
  await offer(back, [], c.handlers);
  assert.equal(shared.cards.length, 1, 'the owner puts the card up');
  assert.deepEqual(c.starts.map((s) => s.actor), ['ask']);
  assert.deepEqual(rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.actor === 'ask').map((r) => [r.session, r.payload.phase]),
    [['owner', 'start'], ['owner', 'done']]);

  await offer(open(root, { session: 'owner' }), [], c.handlers);
  assert.equal(shared.cards.length, 1, 'and only once');
});

test('C-two-hosts-one-item: an owner\'s host and another session\'s host restored together put the card up once', async () => {
  const { root, a } = await ownedWithCardOpen();
  const shared = platform();
  const mine = open(root, { session: 'owner' });
  const theirs = open(root, { session: 'other' });
  await offer(theirs, [], counting({ plat: shared, actors: a.byActor }).handlers);
  await offer(mine, [], counting({ plat: shared, actors: a.byActor }).handlers);
  await offer(theirs, [], counting({ plat: shared, actors: a.byActor }).handlers);
  assert.equal(shared.cards.length, 1);
  assert.equal(new Set(shared.cards.map((c) => c.key)).size, 1);
});

test('C-two-hosts-one-item: bin/host.js wake from another session posts nothing and adds no row; the owner\'s next call finishes the card once', async () => {
  const root = fresh();
  // The owner's session files the item and takes it to its card, with the agents as stubs.
  const owner = open(root, { session: 'owner-session' });
  const a = agents({ brief: [{ builder: 'b.md', verifier: 'v.md' }], build: [{ pr: { branch: 'build/x', headSha: A, url: 'https://github.com/o/r/pull/1' } }], verify: [{ result: 'PASS', sha: A, report: 'r' }] });
  await offer(owner, [start('owner-session')], handlers({ github: null, hearth: null, actors: a.byActor }));
  assert.equal(owner.snapshot.value, 'awaitingMerge');
  const ask = pending(owner).runs.find((r) => r.actor === 'ask');
  // The session with the thread put the card up and its record is there, but no `card` call has finished it yet.
  const file = cardFile(root, ask.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ effect: ask.id, ref: 'cmsg_card1' }));

  const before = readFileSync(itemFile(root, 'it-1'), 'utf8');
  const hook = (session) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt: timeWake('2999-01-01T00:00:00Z') });
  const w = await hostCli(root, ['wake'], { input: hook('other-session') });
  assert.equal(w.status, 0, w.stderr);
  assert.equal(readFileSync(itemFile(root, 'it-1'), 'utf8'), before, 'no row in the item\'s file');
  assert.ok(pending(open(root)).effects.some((e) => e.id === ask.id), 'the card effect is still open');
  if (existsSync(sessionFile(root, 'other-session'))) {
    assert.ok(sessionRows(root, 'other-session').every((r) => r.payload?.outcome === 'not-owner'), 'anything it was offered is turned away');
  }

  const o = await hostCli(root, ['wake'], { input: hook('owner-session') });
  assert.equal(o.status, 0, o.stderr);
  const ends = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.effect === ask.id);
  assert.deepEqual(ends.map((r) => [r.session, r.payload.phase]), [['owner-session', 'start'], ['owner-session', 'done']]);
  assert.equal(ends[1].payload.outcome.ref, 'cmsg_card1');
});
