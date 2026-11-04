export const meta = {
  name: 'design-tournament',
  description: 'Four independent designers plus a control, each built and tested by an executor helper, blind-judged, a deletion round, final judge',
  phases: [
    { title: 'Design', detail: '4 independent designers, one stance each' },
    { title: 'Build', detail: 'executor helpers make each design run and test the 12 scenarios' },
    { title: 'Judge', detail: 'blind judge reruns tests and scores' },
    { title: 'Delete', detail: 'top 2 plus control must remove a primitive' },
    { title: 'Final', detail: 'final judge writes result.md' },
  ],
}

const SP = args.scratch
const OUT = '/mnt/project-files/design-tournament'
const PACK = OUT + '/pack.md'

const STANCES = [
  { lane: 'A', name: 'minimalist', stance: 'Minimalist. Your design must express all three workflows with FEWER primitives than the baseline listed in the pack. Prefer deleting and generalising existing primitives over adding. Every primitive you keep must be used by at least two of the three workflows.' },
  { lane: 'B', name: 'event-sourcing', stance: 'Event sourcing and durable execution (Temporal, Elm Architecture, Mealy machines). Treat the journal as the source of truth and state as a fold; think in terms of commands, events, activities with idempotency keys, workflow versioning and signals.' },
  { lane: 'C', name: 'provenance', stance: 'Supply-chain provenance (SLSA, in-toto, Bazel/Nix derivations). Think in terms of content-addressed artifacts, action keys, attestations with subject digests produced by the platform rather than the worker, and layouts/policies checked at the end.' },
  { lane: 'D', name: 'wildcard', stance: 'Wildcard. Do NOT keep XState context as the place data lives unless you conclude, after seriously trying an alternative, that it is best. Consider a different decomposition entirely (for example: workflows as pure gate policies over a fact store, a tuple-space/blackboard, a dataflow graph, or a capability model). You may keep XState for control flow or replace parts of it, within the hard constraints.' },
]

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    designFile: { type: 'string' },
    summary: { type: 'string' },
    primitives: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' }, status: { type: 'string', enum: ['kept', 'new', 'changed', 'removed'] }, usedBy: { type: 'array', items: { type: 'string' } } }, required: ['name', 'kind', 'status'] } },
    interpreterChanges: { type: 'array', items: { type: 'string' } },
  },
  required: ['designFile', 'summary', 'primitives', 'interpreterChanges'],
}

const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    workdir: { type: 'string' },
    scenarios: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail', 'not-attempted'] },
      testFile: { type: 'string' }, command: { type: 'string' },
      asserts: { type: 'string', description: 'the assert lines that decide this scenario, quoted' },
      evidence: { type: 'string' } }, required: ['id', 'status'] } },
    primitives: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' }, status: { type: 'string' }, interpreter: { type: 'boolean' } }, required: ['name', 'kind', 'status'] } },
    specLines: { type: 'object', properties: { quickFix: { type: 'number' }, feature: { type: 'number' }, research: { type: 'number' } } },
    taps: { type: 'object', properties: { Q1: { type: 'number' }, F1: { type: 'number' } } },
    hostWorkflowSpecificCode: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
    existingTests: { type: 'string', description: 'result of the existing engine test suite in your workdir' },
    honesty: { type: 'string', description: 'what is reasoned but not executed, what you were unsure counted' },
  },
  required: ['workdir', 'scenarios', 'primitives', 'specLines', 'taps', 'deviations', 'existingTests', 'honesty'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: {
      lane: { type: 'string' }, verifiedPasses: { type: 'number' }, claimedPasses: { type: 'number' },
      primitives: { type: 'number' }, passesPerPrimitive: { type: 'number' }, specLines: { type: 'number' },
      tapsQ1: { type: 'number' }, tapsF1: { type: 'number' }, oneVocabulary: { type: 'boolean' },
      rejectedPasses: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
      required: ['lane', 'verifiedPasses', 'primitives', 'notes'] } },
    ranking: { type: 'array', items: { type: 'string' } },
    bestIdeas: { type: 'array', items: { type: 'object', properties: { lane: { type: 'string' }, idea: { type: 'string' } }, required: ['lane', 'idea'] } },
  },
  required: ['scores', 'ranking', 'bestIdeas'],
}

const designerPrompt = (s) => `You are an independent designer in a design tournament. Read the frozen problem pack at ${PACK} and the code it points to in /home/user/ccp_xstate (read only; do not modify that checkout).

Your stance: ${s.stance}

Independence rule: do NOT read anything under /mnt/project-files/context-design/, any Claude Doc, or any file named options*.md. Other designers exist; you will not see them. Work from the pack, the code and first principles.

Produce ONE design that answers the pack's design question and covers all three workflows (quick-fix, feature, research) and all 12 scenarios. Simplicity is scored: the headline score is scenarios that actually run and pass, divided by primitive count (interpreter changes count double). A design that adds a primitive for each scenario will lose to one whose few primitives compose. Before you finish, try to delete one primitive from your own design and keep it out if the scenarios still hold.

Write the design to ${OUT}/${s.lane}-${s.name}/design.md (mkdir -p first). It must contain, concretely enough for a separate engineer to build without asking you:
1. The core rule(s) in a few sentences.
2. The primitive list in the pack's kinds, marked kept/new/changed/removed versus the baseline, and which workflows use each.
3. The exact context (or state store) shape for each of the three workflows, as JSON.
4. Each workflow's states and transitions, as JSON in the spec's format, or as a precise extension of it (if you extend the format, specify the interpreter change exactly: what spec.js or host.js must do).
5. For each scenario id, the mechanism that satisfies it and the event sequence a test would drive.
6. What you deliberately leave out, and why.

Return the structured summary.`

const executorPrompt = (lane, name, designFile, extra) => `You are the EXECUTOR for design lane ${lane} (${name}) in a design tournament. You are not the designer's ally and not its critic: you are an honest builder-tester. Your only loyalty is to an accurate record of what actually runs.

Read: the problem pack ${PACK}; the design ${designFile}; the engine code in /home/user/ccp_xstate (packages/engine/src/spec.js, host.js, actors.js, wake.js, effects/; test models in packages/engine/test/parity/world.js and C-*.test.js; workflows/quick-fix.json).
${extra || ''}
Workspace (strict):
- Make your own copy: rm -rf ${SP}/tourney/${lane} && mkdir -p ${SP}/tourney && cp -a /home/user/ccp_xstate ${SP}/tourney/${lane}. Work ONLY inside ${SP}/tourney/${lane}. Never modify /home/user/ccp_xstate or another lane's folder.
- No git push, no PRs, no GitHub writes, no network. Everything is driven with stubbed worlds in tests.
- When done, copy your workflows, any changed engine files and your scenario tests to ${OUT}/${lane}-${name}/build/ (keep relative paths).

What to build, in this order:
1. The design's workflow files for quick-fix, feature and research (JSON in the design's format) under workflows/ in your copy.
2. Any interpreter change the design specifies, in packages/engine/src/. Implement exactly what the design says. Each interpreter feature you add is a primitive and counts double; list it.
3. One test file per scenario under packages/engine/test/tourney/<id>.test.js (node:test, node:assert). Drive the real interpreter (machineOf/transition, or the host with the parity world stubs) with the event sequence the scenario needs, and assert the scenario's STATED outcome from the pack.
4. Run each: node --test packages/engine/test/tourney/<id>.test.js. Also run the existing engine tests: node --test 'packages/engine/test/**/*.test.js' (a glob; Node 22 fails on a bare directory) and report the counts.

Rules that make your report worth anything:
- A scenario is "pass" ONLY if its test runs and passes in your copy. Reasoned-but-not-run is "not-attempted". A test that fails after honest effort is "fail". Give the command and quote the assert lines that decide it.
- Assert the outcome the pack states, not a weaker proxy. Q4 must show no merge on CI-green without an explicit person approval of a CI-changing PR. Q5 must show the verdict does not count when the worktree head differs. F1 must show bounded rounds, slice 1 kept, and whole-feature verification before main with at most one person tap. R1 must show the join completes with one failed child and that publish needs approval.
- Never stub, hard-code or bypass the mechanism under test (no stubbing the guard, no pre-setting the context to the answer). Stub only the outside world (GitHub, cards, clock, agents' outputs).
- If the design is ambiguous or broken, make the smallest change that makes it work, and record it in deviations, with its primitive cost. Do not silently improve the design. If a fix would need a big redesign, mark the scenario fail and say why.
- Count primitives with the pack's kinds, including interpreter changes (flag interpreter: true). Count spec size as pretty-printed JSON lines per workflow (e.g. node -e "console.log(JSON.stringify(require('./workflows/x.json'),null,2).split('\\n').length)"). Count person card taps on the Q1 happy path and on F1.
- Report any host code that is specific to one workflow (hostWorkflowSpecificCode).
- Work in scenario order Q1..Q9, F1, F2, R1. If one scenario has eaten many attempts, mark it and move on so the others get done.

Return the structured report. Your workdir is ${SP}/tourney/${lane}.`

phase('Design')
const lanes = await pipeline(
  STANCES,
  (s) => agent(designerPrompt(s), { label: `design:${s.name}`, phase: 'Design', schema: DESIGN_SCHEMA }),
  (d, s) => d && agent(executorPrompt(s.lane, s.name, d.designFile), { label: `build:${s.name}`, phase: 'Build', schema: EXEC_SCHEMA }).then((e) => ({ lane: s.lane, name: s.name, design: d, exec: e })),
)

phase('Build')
const control = await agent(executorPrompt('E', 'control', '/mnt/project-files/context-design/options.md',
  `Your design is option A in that file (the recommended one: fix quick-fix in place, flat chart, no interpreter change). It covers quick-fix fully. For feature and research, use the parts of option B that the file names (child items, fan-out, publish, intent/plan, meta.subject), counting each as a primitive. You may read /mnt/project-files/context-design/ for details; the other lanes may not.`),
  { label: 'build:control', phase: 'Build', schema: EXEC_SCHEMA })
const all = [...lanes.filter(Boolean), { lane: 'E', name: 'control', design: { designFile: '/mnt/project-files/context-design/options.md' }, exec: control }]
log(`built ${all.length} lanes`)

const laneBrief = (l) => `Lane ${l.lane}: design ${l.design?.designFile}; executor report: ${JSON.stringify(l.exec)}`

const judgePrompt = (lanesList, final) => `You are the ${final ? 'FINAL' : 'round-1'} blind judge of a design tournament. Read the problem pack ${PACK}. Lanes are named by letter only; judge the work, not the stance.

For each lane, the design file and the executor's report are below. Do not trust the reports: for every scenario a lane claims "pass", cd into its workdir and rerun the command yourself, and read the test to check it asserts the pack's stated outcome without stubbing the mechanism under test. Count a pass only if both hold, and list the rejected ones with the reason. Recount primitives with the pack's kinds (interpreter changes count double) where a report looks low. Check whether all three workflows use one vocabulary with no workflow-specific host code.

Score per the pack's measures. Headline: verified passes divided by primitives. Then rank. Then list the best ideas, each attributed to its lane, especially ideas that REMOVE primitives or let one primitive serve several scenarios.
${final ? `This is the final round: lanes after a deletion round. Compare to the round-1 scores given below. Then write ${OUT}/result.md: the ranking table, whether any lane beats lane E (the control) on verified passes per primitive, the single recommended design (it may be a lane, or a lane plus named grafts that were actually executed), what it costs to adopt, what remains reasoned only, and a short honest note on whether the tournament found a meaningfully different, simpler design or converged near the control.` : ''}

${lanesList}`

phase('Judge')
const j1 = await agent(judgePrompt(all.map(laneBrief).join('\n\n'), false), { label: 'judge:round1', phase: 'Judge', schema: JUDGE_SCHEMA })
log(`round 1 ranking: ${j1 ? j1.ranking.join(' > ') : 'judge failed'}`)

phase('Delete')
const nonControl = (j1?.ranking || []).filter((x) => x !== 'E')
const picks = [...nonControl.slice(0, 2), 'E']
const ideas = JSON.stringify(j1?.bestIdeas || [])
const round2 = await parallel(picks.map((lane) => () => {
  const l = all.find((x) => x.lane === lane)
  if (!l) return null
  return agent(executorPrompt(l.lane, l.name, l.design.designFile,
    `DELETION ROUND. Your copy from round 1 is already at ${SP}/tourney/${l.lane}: do NOT recreate it (skip the rm/cp step) and continue from it. Your previous report: ${JSON.stringify(l.exec)}.
Task: remove at least one primitive from this design and show which scenarios still pass by rerunning every scenario test. You may also graft at most ONE idea from this list of the judge's best ideas from other lanes, but only if you remove at least one more primitive to make room: ${ideas}.
Write what you removed and grafted, and why, to ${OUT}/${l.lane}-${l.name}/round2.md, and copy updated files to ${OUT}/${l.lane}-${l.name}/build/. Report the full new state (all scenarios, all primitives), not only the change.`),
    { label: `delete:${l.name}`, phase: 'Delete', schema: EXEC_SCHEMA }).then((e) => ({ ...l, exec: e || l.exec }))
}))
const finalLanes = all.map((l) => round2.filter(Boolean).find((r) => r.lane === l.lane) || l)

phase('Final')
const j2 = await agent(judgePrompt(finalLanes.map(laneBrief).join('\n\n') + `\n\nRound-1 judge scores: ${JSON.stringify(j1?.scores || [])}`, true),
  { label: 'judge:final', phase: 'Final', schema: JUDGE_SCHEMA })
return { round1: j1, final: j2, lanes: finalLanes.map((l) => ({ lane: l.lane, name: l.name, designFile: l.design?.designFile })) }
