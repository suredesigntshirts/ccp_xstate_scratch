// Stage-contract cleanup, item F: every model-stage run of the quick-fix happy path (as Q1) leaves a complete stage
// record, runs/<n>.<actor>/stage.json: the stage and its workflow (with hash), the prompt as its parts with each
// piece's source, every input with its meaning, value, the context path it was read from and its producer, and, once
// the item took the result, the output, the context paths written from it and the invokes that read them. Each input's
// producer is checked against the run that really produced it. brief.md, context.md and the journal rows stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDir } from '../../src/actors.js';
import { assemble, DATA_RULE, WORKTREE_RULE, returnLine, runLine } from '../../src/stages.js';
import { makeWorld, ISSUE, BRIEFS, prUrl, builds, verifies, tapWake, suiteWake, offer, pending } from './world.js';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const FILE = new URL('../../../../workflows/quick-fix.json', import.meta.url);
const BYTES = readFileSync(FILE);
const WF = JSON.parse(BYTES.toString('utf8'));
/** The value at a JSON pointer in the workflow file. */
const at = (ptr) => ptr.split('/').slice(1).map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((v, k) => v?.[k], WF);
const FRAME = { DATA_RULE, WORKTREE_RULE, none: '(none)' };

test('S4: the quick-fix happy path leaves a complete stage record per run, each input traced to its real producer', async () => {
  const w = await makeWorld();
  try {
    const runs = {};
    const results = {};
    await w.start('q1', 'quick-fix', { issue: ISSUE });
    runs.brief = w.openRun('q1', 'brief').id;
    results.brief = BRIEFS;
    assert.ok((await w.agent('q1', 'brief', () => BRIEFS)).accepted);
    await w.drive('q1');
    runs.build = w.openRun('q1', 'build').id;
    assert.ok((await w.agent('q1', 'build', builds(w, 1, { green: false }))).accepted);
    await w.drive('q1');
    const head = w.gh.state[1].head;
    results.build = { pr: { url: prUrl(1), at: head } };
    w.gh.green(head);
    await w.drive('q1', suiteWake(head, 1));
    runs.verify = w.openRun('q1', 'verify').id;
    assert.ok((await w.agent('q1', 'verify', verifies(w, 'PASS'))).accepted);
    await w.drive('q1');
    await w.drive('q1', tapWake(w.cardOf('q1'), 0));
    assert.equal(w.host('q1').snapshot.value, 'done', 'the happy path ran to the end');

    const rows = w.rows('q1');
    const applied = rows.filter((r) => r.kind === 'engine.transition' && r.payload.outcome === 'applied');
    assert.ok(applied.every((r) => Array.isArray(r.payload.writes)), 'every applied transition journals its writes');
    const stamped = (run) => JSON.parse(readFileSync(join(runDir(w.root, run), 'result.json'), 'utf8')).result;

    for (const [actor, run] of Object.entries(runs)) {
      const dir = runDir(w.root, run);
      for (const f of ['brief.md', 'context.md', 'run.json', 'stage.json']) assert.ok(existsSync(join(dir, f)), `${actor}: ${f}`);
      const prompt = readFileSync(join(dir, 'brief.md'), 'utf8');
      const rec = JSON.parse(readFileSync(join(dir, 'stage.json'), 'utf8'));
      const runJson = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));

      // (1) What it is: the stage, its workflow by name and hash, the invoke and state that started it.
      assert.equal(rec.run, run);
      assert.equal(rec.stage, actor);
      assert.deepEqual(rec.workflow, { id: `quick-fix@${sha256(BYTES)}`, name: 'quick-fix', hash: sha256(BYTES) });
      assert.equal(at(rec.invokeAt).src, actor, `${actor}: invokeAt points at its invoke`);
      assert.ok(rows.some((r) => r.kind === 'brief.stored' && r.payload.run === run && r.payload.hash === rec.prompt.hash), `${actor}: brief.stored row kept`);

      // (2) The instructions: the parts assemble to the prompt exactly, and every piece names a source that holds it.
      assert.equal(assemble(rec.prompt.parts), prompt, `${actor}: the parts are the prompt`);
      assert.equal(rec.prompt.hash, sha256(prompt));
      for (const [part, pieces] of Object.entries(rec.prompt.parts)) {
        for (const p of pieces) {
          const { source } = p;
          // A frame piece says whether its text is fixed or filled per run, and from which run facts.
          if (source.frame) assert.ok((source.fixed === true) !== ('filled' in source), `${actor} ${part}: frame ${source.frame} is fixed or filled`);
          if (source.frame === 'returnLine') {
            assert.deepEqual(source.filled, { run });
            assert.equal(p.text, returnLine(source.filled.run));
          } else if (source.frame === 'runLine') {
            assert.deepEqual(source.filled, { run, worktree: runJson.worktree, repo: runJson.repo, branch: runJson.branch });
            assert.equal(p.text, runLine(source.filled));
            assert.equal(p.text, runLine(runJson));
          } else if (source.frame) assert.equal(p.text, FRAME[source.frame], `${actor} ${part}: frame ${source.frame}`);
          else if (source.workflow && part === 'rules') assert.equal(p.text, `- ${at(source.workflow)}`, `${actor}: rule at ${source.workflow}`);
          else if (source.workflow && part === 'output' && p.text.startsWith('- ')) assert.ok(p.text.endsWith(`: ${at(source.workflow)}`), `${actor}: description at ${source.workflow}`);
          else if (source.workflow) assert.ok(p.text.startsWith('Schema: ') && at(source.workflow).type === 'object', `${actor}: schema at ${source.workflow}`);
          else {
            assert.ok(source.input, `${actor} ${part}: a piece without a source`);
            const input = rec.inputs.find((i) => i.name === source.input);
            assert.deepEqual(source.producer, input.producer, `${actor}: ${part} piece carries its input's producer`);
            assert.ok(!('meaning' in source), `${actor} ${part}: a piece names its meaning as meaningAt, as inputs do`);
            assert.equal(source.meaningAt, input.meaningAt, `${actor} ${part}: meaningAt as the input's`);
            assert.equal(at(source.meaningAt), input.meaning);
            if (part === 'task') assert.equal(p.text, input.value);
          }
        }
      }
      assert.equal(rec.prompt.parts.rules.filter((p) => p.source.workflow).length, WF.meta.actors[actor].rules.length);

      // (3) The inputs: every declared input, with its meaning, value and the wiring it was read through.
      assert.deepEqual(rec.inputs.map((i) => i.name).sort(), Object.keys(WF.meta.actors[actor].inputs).sort());
      for (const i of rec.inputs) {
        assert.equal(i.meaning, at(i.meaningAt), `${actor}.${i.name}: meaning from the JSON`);
        assert.deepEqual(i.value, runJson.input[i.name] ?? null, `${actor}.${i.name}: the value the run got`);
        assert.deepEqual(i.from, at(i.wiredAt), `${actor}.${i.name}: wired at ${i.wiredAt}`);
        assert.ok(i.producer?.kind, `${actor}.${i.name}: has a producer`);
      }

      // (4) Where the output went: the output, the paths written from it, and who reads them.
      assert.ok(rec.finished, `${actor}: finished`);
      assert.ok(!('ended' in rec), `${actor}: the half is named finished, not ended (a state name elsewhere)`);
      assert.ok(Array.isArray(rec.finished.state) && rec.finished.state.every((x) => typeof x === 'string'), `${actor}: finished.state is a list of dotted paths`);
      assert.deepEqual(rec.output, stamped(run), `${actor}: the output is the accepted (stamped) result`);
      // stamped names every field in the output the host wrote: the agent's own return is the output without them.
      assert.ok(Array.isArray(rec.stamped), `${actor}: stamped is listed`);
      const own = structuredClone(rec.output);
      for (const s of rec.stamped) {
        const segs = s.split('.');
        const holder = segs.slice(0, -1).reduce((v, k) => v[k], own);
        assert.ok(Object.hasOwn(holder, segs.at(-1)), `${actor}: stamped ${s} is in the output`);
        delete holder[segs.at(-1)];
      }
      assert.deepEqual(own, results[actor] ?? own, `${actor}: the output less stamped is what the agent returned`);
      assert.ok(!JSON.stringify(own).match(/"(key|checkout|gates|green)":/), `${actor}: no stamped field left unmarked`);
      assert.ok(rec.wrote.length > 0, `${actor}: wrote something`);
      for (const wr of rec.wrote) {
        assert.deepEqual(at(wr.at), wr.from, `${actor}: write at ${wr.at}`);
        assert.equal(typeof wr.into, 'string', `${actor}: into is a dotted path`);
        assert.ok(wr.into === rec.finished.state[0] || rec.finished.state[0].startsWith(`${wr.into}.`), `${actor}: into ${wr.into} holds finished.state`);
        assert.equal(wr.replaced, null, `${actor}: a first run replaces only the context default`);
      }
    }

    const rec = (actor) => JSON.parse(readFileSync(join(runDir(w.root, runs[actor]), 'stage.json'), 'utf8'));
    const input = (actor, name) => rec(actor).inputs.find((i) => i.name === name);
    const brief = rec('brief');
    const build = rec('build');
    const verify = rec('verify');

    // Producers match the runs that really produced each value.
    assert.deepEqual(input('brief', 'task').producer, { kind: 'literal', at: '/states/briefing/invoke/input/task/value' });
    assert.equal(at(input('brief', 'task').producer.at), input('brief', 'task').value);
    assert.equal(input('brief', 'issue').producer.kind, 'initial');
    assert.equal(input('brief', 'issue').producer.field, 'issue');
    for (const k of ['why', 'base', 'branch']) assert.deepEqual(input('brief', k).producer, { kind: 'default', at: `/context/${k}` });

    const task = input('build', 'task').producer;
    assert.equal(task.kind, 'stage');
    assert.equal(task.run, runs.brief, 'build task came from the brief run');
    assert.equal(task.actor, 'brief');
    assert.equal(task.field, 'builder');
    assert.equal(input('build', 'task').value, BRIEFS.builder);
    assert.equal(build.prompt.parts.task[0].source.producer.run, runs.brief, 'the Task part names the brief run');
    assert.equal(input('build', 'issue').producer.kind, 'initial');
    for (const k of ['previous', 'verdict', 'failure']) assert.equal(input('build', k).producer.kind, 'default', `first build: ${k} is the default`);

    const vt = input('verify', 'task').producer;
    assert.deepEqual([vt.kind, vt.run, vt.field], ['stage', runs.brief, 'verifier']);
    const target = input('verify', 'target');
    assert.deepEqual([target.producer.kind, target.producer.run, target.producer.actor, target.producer.field], ['stage', runs.build, 'build', 'pr']);
    assert.deepEqual(target.amended.map((a) => [a.path, a.by.kind, a.by.event]),
      [['pr.at', 'event', 'github.check_suite.completed'], ['pr.green', 'literal', 'github.check_suite.completed']], 'the suite event moved the head and set green');
    const checkout = input('verify', 'checkout').producer;
    assert.deepEqual([checkout.kind, checkout.stamped, checkout.run, checkout.actor, checkout.field], ['host', 'checkout', runs.build, 'build', 'pr.checkout'], 'checkout: stamped by the host on build\'s pr, not written by the build agent');
    assert.equal(input('verify', 'checkout').value, stamped(runs.build).pr.checkout);

    // Where each output went, and which invokes in the chart read it.
    assert.deepEqual(brief.wrote.map((x) => [x.path, x.from]), [['briefs', 'event.output']]);
    const readsBriefs = brief.wrote[0].readBy.map((r) => `${r.state}:${r.actor}.${r.input}`).sort();
    assert.deepEqual(readsBriefs, ['building:build.task', 'reverifying:verify.task', 'verifying:verify.task']);
    assert.deepEqual(build.wrote.map((x) => [x.path, x.from]), [['pr', 'event.output.pr']]);
    const readsPr = build.wrote[0].readBy.filter((r) => r.kind === 'stage').map((r) => `${r.state}:${r.actor}.${r.input}`).sort();
    assert.deepEqual(readsPr, ['building:build.previous', 'reverifying:verify.checkout', 'reverifying:verify.target', 'verifying:verify.checkout', 'verifying:verify.target']);
    const selfReads = build.wrote[0].readBy.filter((r) => r.self).map((r) => `${r.state}:${r.actor}.${r.input}`);
    assert.deepEqual(selfReads, ['building:build.previous'], 'the build reading its own pr as previous is marked self, and only it');
    assert.ok(brief.wrote[0].readBy.every((r) => !r.self) && verify.wrote[0].readBy.every((r) => !r.self), 'brief and verify read none of their own writes');
    assert.deepEqual(build.stamped, ['pr.key', 'pr.checkout'], 'build: the host stamped key and checkout on its pr (not green: the suite came later)');
    assert.deepEqual(brief.stamped, [], 'brief: nothing stamped');
    assert.ok(build.wrote[0].readBy.some((r) => r.kind === 'effect' && r.actor === 'merge' && r.input === 'pr'));
    assert.deepEqual(verify.wrote.map((x) => [x.path, x.from]), [['verdict', 'event.output']]);
    assert.ok(verify.wrote[0].readBy.some((r) => r.actor === 'build' && r.input === 'verdict'), 'a FAIL verdict would reach the next build');
    assert.deepEqual(verify.finished.state, ['awaitingMerge']);
    assert.ok(verify.stamped.includes('pr.key') && verify.stamped.includes('pr.checkout') && verify.stamped.includes('pr.green'), 'verify: the host stamped its pr, green included');
  } finally {
    await w.close();
  }
});

test('S4: a FAIL loop, a head move and a replan: every producer is the run that really wrote it, and a stopped run says so', async () => {
  const w = await makeWorld();
  const R = {};
  const rec = (id) => JSON.parse(readFileSync(join(runDir(w.root, id), 'stage.json'), 'utf8'));
  const input = (id, name) => rec(id).inputs.find((i) => i.name === name);
  try {
    await w.start('x', 'quick-fix', { issue: ISSUE });
    R.brief1 = w.openRun('x', 'brief').id;
    assert.ok((await w.agent('x', 'brief', () => BRIEFS)).accepted);
    await w.drive('x');
    R.build1 = w.openRun('x', 'build').id;
    assert.ok((await w.agent('x', 'build', builds(w, 1))).accepted);
    await w.drive('x');
    R.verify1 = w.openRun('x', 'verify').id;
    assert.ok((await w.agent('x', 'verify', verifies(w, 'FAIL'))).accepted);
    await w.drive('x');
    assert.equal(w.host('x').snapshot.value, 'building');
    R.build2 = w.openRun('x', 'build').id;
    assert.ok((await w.agent('x', 'build', builds(w, 1), 'b2')).accepted);
    await w.drive('x');
    assert.equal(w.host('x').snapshot.value, 'verifying');
    R.stopped = w.openRun('x', 'verify').id;
    const moved = w.commit(w.repo, 'moved');
    w.gh.push(1, moved);
    w.gh.green(moved);
    await w.drive('x', suiteWake(moved, 1));
    assert.equal(w.host('x').snapshot.value, 'reverifying');
    R.verify2 = w.openRun('x', 'verify').id;
    assert.notEqual(R.verify2, R.stopped);
    assert.ok((await w.agent('x', 'verify', verifies(w, 'FAIL'), 'v2')).accepted);
    await w.drive('x');
    assert.equal(w.host('x').snapshot.value, 'replanning');
    const h = w.host('x');
    const ask = pending(h).runs.find((r) => r.actor === 'ask');
    await offer(h, [{ event: { type: `xstate.done.actor.${ask.invoke}`, output: { choice: 'replan', by: 'person', why: 'WHY' } }, run: ask.id, source: { system: 'hearth', ref: 'c:typed' } }], w.handlersFor(h));
    await w.drive('x');
    R.brief2 = w.openRun('x', 'brief').id;
    assert.ok((await w.agent('x', 'brief', () => ({ builder: 'B2', verifier: 'V2' }), 'br2')).accepted);
    await w.drive('x');
    R.build3 = w.openRun('x', 'build').id;

    const by = (id, name) => { const p = input(id, name).producer; return [p.kind, p.run ?? null, p.field ?? null]; };
    assert.deepEqual(by(R.build2, 'verdict'), ['stage', R.verify1, null], 'build2 fixes verify1\'s verdict');
    assert.deepEqual(by(R.build2, 'previous'), ['stage', R.build1, 'pr']);
    assert.deepEqual(by(R.build2, 'task'), ['stage', R.brief1, 'builder']);
    assert.deepEqual(by(R.verify2, 'target'), ['stage', R.build2, 'pr']);
    assert.deepEqual(input(R.verify2, 'target').amended.map((a) => [a.path, a.by.kind]), [['pr.at', 'event'], ['pr.green', 'literal']], 'the head move amended the target');
    assert.deepEqual(by(R.verify2, 'checkout'), ['host', R.build2, 'pr.checkout']);
    assert.deepEqual(by(R.brief2, 'why'), ['effect', ask.id, 'why'], 'the typed why came from the ask');
    assert.deepEqual(by(R.build3, 'task'), ['stage', R.brief2, 'builder']);
    assert.equal(input(R.build3, 'task').value, 'B2');
    for (const k of ['previous', 'verdict', 'failure']) {
      const p = input(R.build3, k).producer;
      assert.equal(p.kind, 'literal', `build3 ${k}: reset by the replan`);
      assert.ok(p.at.startsWith('/states/replanning/invoke/onDone/0/actions/0/params/'), `build3 ${k}: at ${p.at}`);
    }
    // The verify run the head move stopped: ended, marked stopped, with no output and nothing written.
    const gone = rec(R.stopped);
    assert.equal(gone.finished?.stopped, true, 'a stopped run says so');
    assert.deepEqual(gone.finished.state, ['reverifying']);
    assert.ok(!('output' in gone) && !('stamped' in gone) && gone.wrote.length === 0);
    // Each write says what it replaced: build2's pr replaced build1's; verify2's verdict replaced nothing, since
    // build2's transition reset verdict to a literal null.
    const b2 = rec(R.build2).wrote[0];
    assert.deepEqual([b2.path, b2.replaced?.kind, b2.replaced?.run, b2.replaced?.field], ['pr', 'stage', R.build1, 'pr']);
    const v2 = rec(R.verify2).wrote[0];
    assert.deepEqual([v2.path, v2.replaced], ['verdict', null]);
    assert.equal(rec(R.build1).wrote[0].replaced, null, 'the first build replaced only the default');
    // After the replan reset them, brief2's briefs replaced brief1's.
    const br2 = rec(R.brief2).wrote[0];
    assert.deepEqual([br2.path, br2.replaced?.kind, br2.replaced?.run], ['briefs', 'stage', R.brief1]);
    // verify1's FAIL went into building, and only invokes reachable from there are listed as its readers.
    const v1 = rec(R.verify1);
    assert.equal(v1.wrote[0].into, 'building');
    assert.ok(v1.wrote[0].readBy.some((r) => r.actor === 'build' && r.input === 'verdict'));
  } finally {
    await w.close();
  }
});

test('S4: a null default built wholly from part-writes names the part-writers as its producer (research answers)', async () => {
  const { producerOf } = await import('../../src/trace.js');
  const spec = { context: { answers: null, briefs: {} } };
  const q = (n) => ({ kind: 'stage', run: `r:1.q${n}`, actor: 'researcher', field: null });
  const log = [{ path: 'answers.q1', by: q(1) }, { path: 'answers.q2', by: q(2) }];
  const { producer, amended } = producerOf(log, 'answers', spec);
  assert.deepEqual(producer, { kind: 'parts', default: '/context/answers', parts: [{ path: 'answers.q1', ...q(1) }, { path: 'answers.q2', ...q(2) }] });
  assert.equal(amended, undefined, 'the parts are listed once, under parts, not again as amended');
  // A part read on its own keeps its own writer, and a whole a stage wrote keeps that stage.
  assert.deepEqual(producerOf(log, 'answers.q2', spec).producer, q(2));
  assert.equal(producerOf([{ path: 'answers', by: q(3) }, ...log], 'answers', spec).producer.run, 'r:1.q3');
});
