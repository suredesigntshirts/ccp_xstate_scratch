// The host over a real journal file: restore, applyEvent, persist, runEffects, and wakes into events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from '../../journal/src/index.js';
import { restore, applyEvent, persist, runEffects, offer, pending, itemFile, sessionFile, hashOf, inputsOfWake, wakesIn } from '../src/index.js';
import { A, ISSUE, BRIEFS, workflow, pr } from './flow.js';

const wake = (name) => readFileSync(new URL(`./fixtures/wakes/${name}.txt`, import.meta.url), 'utf8');
const RELEASE = '0.2.0';
const fresh = () => mkdtempSync(join(tmpdir(), 'engine-host-'));
const open = (root, spec = workflow, session = 'owner') => restore({ root, item: 'it-1', spec, session, release: RELEASE });
const start = { event: { type: 'xstate.init', input: { issue: ISSUE } }, source: { system: 'claude-code', ref: 'owner' } };
const rows = (root) => readFile(itemFile(root, 'it-1')).rows;

// A tiny workflow that waits for a GitHub event and then merges: enough to watch one GitHub event start one effect.
const onMerge = {
  id: 'on-merge',
  initial: 'waiting',
  context: { merge: null },
  states: {
    waiting: { on: { 'github.check_run.completed': 'merging' } },
    merging: {
      invoke: { id: 'merge', src: 'merge', input: {}, onDone: { target: 'done', actions: [{ type: 'set', params: { merge: 'event.output' } }] }, onError: 'failed' }
    },
    failed: { type: 'final' },
    done: { type: 'final' }
  },
  meta: {
    guards: {},
    input: { type: 'object' },
    events: { 'github.check_run.completed': { type: 'object' } },
    actors: { merge: { type: 'object', required: ['sha'], properties: { sha: { type: 'string' } } } },
    schemas: {}
  }
};

// Handlers that count what they do, keyed by effect id.
const counting = (overrides = {}) => {
  const did = [];
  const handlers = {
    run: { start: async (effect) => { did.push(effect.id); return overrides[effect.actor]?.(effect) ?? { ref: `ref-${effect.id}` }; } }
  };
  return { did, handlers };
};

test('a started item journals its transition with source, transition id and the effects it asked for', async () => {
  const root = fresh();
  const host = open(root);
  const { did, handlers } = counting({ brief: () => ({ output: BRIEFS }) });
  const [first] = await offer(host, [start], handlers);
  assert.equal(first.outcome, 'applied');
  assert.equal(host.snapshot.value, 'building');
  const written = rows(root);
  const init = written.find((r) => r.kind === 'engine.transition' && r.payload.seq === 0);
  assert.deepEqual(init.source, { system: 'claude-code', ref: 'owner' });
  assert.equal(init.payload.transition, 'it-1#0');
  assert.equal(init.item, 'it-1');
  const effects = written.filter((r) => r.kind === 'engine.effect');
  assert.deepEqual(effects.map((r) => [r.payload.effect, r.payload.phase]), [
    ['it-1:0.brief', 'start'], ['it-1:0.brief', 'done'], ['it-1:1.build', 'start'], ['it-1:1.build', 'done']
  ]);
  assert.deepEqual(did, ['it-1:0.brief', 'it-1:1.build']);
  // The brief's completion came from the effect, not from anyone's say-so.
  assert.deepEqual(written.find((r) => r.payload.seq === 1).source, { system: 'engine', ref: 'it-1:0.brief' });
});

test('the same GitHub event delivered twice starts its effect once', async () => {
  const root = fresh();
  const host = open(root, onMerge);
  const { did, handlers } = counting({ merge: () => ({ ref: 'merge-1' }) });
  await offer(host, [{ ...start, event: { type: 'xstate.init', input: {} } }], handlers);
  const github = inputsOfWake(host, wake('check-run-failed'));
  assert.equal(github.length, 1);
  const results = await offer(host, [...github, ...inputsOfWake(host, wake('check-run-failed'))], handlers);
  assert.deepEqual(results.map((r) => r.outcome), ['applied', 'duplicate']);
  // And again from a fresh host, as a later wake would see it.
  const again = open(root, onMerge);
  assert.deepEqual((await offer(again, inputsOfWake(again, wake('check-run-failed')), handlers)).map((r) => r.outcome), ['duplicate']);
  assert.deepEqual(did, ['it-1:1.merge']);
});

test('a host stopped mid-effect asks the world on restart instead of doing the effect again', async () => {
  const root = fresh();
  const host = open(root, onMerge);
  await offer(host, [{ ...start, event: { type: 'xstate.init', input: {} } }]);
  await offer(host, inputsOfWake(host, wake('check-run-failed')));
  // The effect started and the process died before it ended: only its start row is written.
  const [effect] = pending(host).effects;
  persist(host, { file: host.file, kind: 'engine.effect', source: { system: 'engine', ref: effect.id }, session: 'owner', item: 'it-1', state: null, release: RELEASE, payload: { effect: effect.id, type: 'run', phase: 'start', transition: effect.transition, outcome: null, rule: null, reason: null } });

  const merged = [];
  const handlers = { run: { start: async () => { merged.push('again'); return {}; }, find: async () => ({ ref: 'merge-1', output: { sha: A } }) } };
  const restarted = open(root, onMerge);
  await offer(restarted, [], handlers);
  assert.deepEqual(merged, []);
  assert.equal(restarted.snapshot.value, 'done');
  const ends = rows(root).filter((r) => r.kind === 'engine.effect' && r.payload.effect === effect.id).map((r) => r.payload.phase);
  assert.deepEqual(ends, ['start', 'done']);

  // With no way to look it up, the effect is journalled unknown and never run again.
  const root2 = fresh();
  const other = open(root2, onMerge);
  await offer(other, [{ ...start, event: { type: 'xstate.init', input: {} } }]);
  await offer(other, inputsOfWake(other, wake('check-run-failed')));
  persist(other, { file: other.file, kind: 'engine.effect', source: { system: 'engine', ref: effect.id }, session: 'owner', item: 'it-1', state: null, release: RELEASE, payload: { effect: effect.id, type: 'run', phase: 'start', transition: effect.transition, outcome: null, rule: null, reason: null } });
  const blind = { run: { start: async () => { merged.push('blind'); return {}; } } };
  await offer(open(root2, onMerge), [], blind);
  await offer(open(root2, onMerge), [], blind);
  assert.deepEqual(merged, []);
  assert.deepEqual(rows(root2).filter((r) => r.kind === 'engine.effect').map((r) => r.payload.phase), ['start', 'unknown']);
});

test('a completion from a replaced run is journalled stale and changes nothing', async () => {
  const root = fresh();
  const host = open(root);
  const { handlers } = counting({ brief: () => ({ output: BRIEFS }), build: () => ({ output: pr(A) }) });
  await offer(host, [start], handlers);
  assert.equal(host.snapshot.value, 'verifying');
  // A push re-enters verifying: the first verify run is stopped and a new one starts.
  const [pushed] = await offer(host, [{ event: { type: 'pr.pushed', headSha: 'b'.repeat(40) }, source: { system: 'github', ref: 'push-b' } }], handlers);
  assert.equal(pushed.outcome, 'applied');
  const before = hashOf(host.snapshot);
  const [old] = await offer(host, [{ event: { type: 'xstate.done.actor.verify', output: { result: 'PASS', sha: A, report: 'r' } }, run: 'it-1:2.verify', source: { system: 'engine', ref: 'old-verify' } }], handlers);
  assert.equal(old.outcome, 'stale');
  assert.match(old.row.payload.reason, /run it-1:2\.verify is not in flight/);
  assert.equal(hashOf(host.snapshot), before);
  assert.equal(hashOf(open(root).snapshot), before);
});

test('a refused effect is journalled with its rule, not retried, and the item steps back', async () => {
  const root = fresh();
  const host = open(root);
  let builds = 0;
  const { handlers } = counting({
    brief: () => ({ output: BRIEFS }),
    build: () => { builds += 1; return { refused: { rule: '[Self-Modification]', text: 'no' } }; }
  });
  await offer(host, [start], handlers);
  assert.equal(host.snapshot.value, 'replanning');
  assert.match(host.snapshot.context.failure, /refused by \[Self-Modification\]/);
  await offer(open(root), [], handlers);
  assert.equal(builds, 1);
  const refused = rows(root).find((r) => r.kind === 'engine.effect' && r.payload.phase === 'refused');
  assert.equal(refused.payload.rule, '[Self-Modification]');
  assert.equal(refused.payload.effect, 'it-1:1.build');
});

test("replaying an item's journal rebuilds its snapshot exactly", async () => {
  const root = fresh();
  const host = open(root);
  const { handlers } = counting({ brief: () => ({ output: BRIEFS }), build: () => ({ output: pr(A) }), verify: () => ({ output: { result: 'PASS', sha: A, report: 'r' } }) });
  await offer(host, [start], handlers);
  const back = open(root);
  assert.equal(back.snapshot.value, 'awaitingMerge');
  assert.equal(hashOf(back.snapshot), hashOf(host.snapshot));
  assert.deepEqual(back.snapshot.context, host.snapshot.context);
  assert.deepEqual(pending(back), pending(host));
  const last = rows(root).filter((r) => r.kind === 'engine.transition').at(-1);
  assert.equal(hashOf(back.snapshot), last.payload.hash);
});

test('a second session is refused the item and the refusal goes to its own file', async () => {
  const root = fresh();
  await offer(open(root), [start]);
  const intruder = open(root, workflow, 'intruder');
  assert.equal(intruder.owner, 'owner');
  const [result] = await offer(intruder, [{ event: { type: 'pr.pushed', headSha: A }, source: { system: 'github', ref: 'x' } }]);
  assert.equal(result.outcome, 'not-owner');
  const own = readFile(sessionFile(root, 'intruder')).rows;
  assert.equal(own.length, 1);
  assert.equal(own[0].payload.outcome, 'not-owner');
  assert.equal(rows(root).filter((r) => r.session === 'intruder').length, 0);
  // Two sessions racing to start the same item: the second's start finds the file made and is refused.
  const a = open(fresh(), workflow, 'a');
  const b = restore({ root: a.root, item: 'it-1', spec: workflow, session: 'b', release: RELEASE });
  await offer(a, [{ ...start, source: { system: 'claude-code', ref: 'a' } }]);
  const [raced] = await offer(b, [{ ...start, source: { system: 'claude-code', ref: 'b' } }]);
  assert.equal(raced.outcome, 'not-owner');
});

test('an event with no source, or one the workflow does not take from outside, is refused', () => {
  const root = fresh();
  const host = open(root);
  persist(host, applyEvent(host, start).row);
  assert.equal(applyEvent(host, { event: { type: 'pr.pushed', headSha: A }, source: null }).outcome, 'refused');
  const github = inputsOfWake(host, wake('pr-merged'));
  const result = applyEvent(host, github[0]);
  assert.equal(result.outcome, 'refused');
  assert.match(result.row.payload.reason, /github\.pull_request\.closed is not an event quick-fix takes from outside/);
});

test('a wake-shaped line inside agent text is not read', () => {
  const host = open(fresh());
  const indented = wake('check-run-failed').split('\n').map((line) => `  ${line}`).join('\n');
  assert.deepEqual(inputsOfWake(host, `[Subagent hand-back] report:\n${indented}`), []);
  assert.deepEqual(inputsOfWake(host, `see <wake reason="x" current-time="2099-01-01T00:00:00Z"></wake>`), []);
});

test('real wakes parse into events whose source is the envelope', async () => {
  const [run] = wakesIn(wake('check-run-failed'));
  assert.equal(run.reason, 'external-event');
  assert.equal(run.github[0].kind, 'check_run.completed');
  assert.equal(run.github[0].data.check_run_id, 124199251145);
  const host = open(fresh());
  const [input] = inputsOfWake(host, wake('check-suite-completed'));
  assert.equal(input.event.type, 'github.check_suite.completed');
  assert.equal(input.source.system, 'github');
  assert.equal(input.at, '2026-10-30T18:06:40.000Z');
  // A ReadNotifications result holds the wake as a JSON string; the same event parses to the same source.
  const nested = JSON.stringify({ notifications: [{ content: wake('check-suite-completed') }] });
  assert.deepEqual(inputsOfWake(host, JSON.parse(nested).notifications[0].content)[0].source, input.source);
});

test('a tap on a card a run posted completes that run; a timer fires once it is due', async () => {
  const root = fresh();
  const host = open(root);
  const card = 'cmsg_01VhYV3jhQ9s4qrrh2th12sN7oo3Bm18DgfoRpQy3bR2XZ';
  const { handlers } = counting({
    brief: () => ({ output: BRIEFS }),
    build: () => ({ refused: { rule: 'r' } }),
    ask: () => ({ ref: card, choices: ['drop', 'replan'] })
  });
  await offer(host, [start], handlers);
  assert.equal(host.snapshot.value, 'replanning');
  const tap = inputsOfWake(host, wake('tap-wake'));
  assert.deepEqual(tap[0].source, { system: 'hearth', ref: card });
  const [result] = await offer(host, tap, handlers);
  assert.equal(result.outcome, 'applied');
  assert.equal(host.snapshot.value, 'dropped');

  // The build's timeout is a timer the host set; a wake after it is due fires it, once.
  const timed = open(fresh());
  await offer(timed, [start], counting({ brief: () => ({ output: BRIEFS }) }).handlers);
  const [timer] = pending(timed).timers;
  assert.ok(Date.parse(timer.due) > Date.now() + 3500000);
  assert.equal(inputsOfWake(timed, wake('check-suite-completed')).filter((i) => i.source.system === 'timer').length, 0);
  const later = new Date(Date.parse(timer.due) + 1000).toISOString();
  const late = `<wake reason="scheduled" current-time="${later}"></wake>`;
  // A wake's time can't run ahead of the host's clock: the same wake fires nothing until the clock is past due.
  assert.deepEqual(inputsOfWake(timed, late).filter((i) => i.source.system === 'timer'), []);
  const fired = await offer(timed, inputsOfWake(timed, late, { now: later }));
  assert.deepEqual(fired.map((r) => r.outcome), ['applied']);
  assert.equal(timed.snapshot.value, 'replanning');
  assert.deepEqual(inputsOfWake(timed, late, { now: later }).filter((i) => i.source.system === 'timer'), []);
});
