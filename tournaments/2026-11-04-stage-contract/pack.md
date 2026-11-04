# Stage-contract tournament: problem pack (frozen 2026-11-04, base = lane A of 2026-11-03-context at 23c3290)

## The question
Does a **stage contract** make lane A simpler and fix the stage-by-stage prompt critique's findings at the root,
without losing any behaviour?

A stage contract means every model stage (brief, build, verify, and any other agent actor) is declared in the
workflow JSON with the same small set of parts, and one engine function renders every prompt from those parts and
nothing else. The proposal under test has six parts: role, task, inputs (each a field with a meaning and a trust
level: instructions or data), limits, output (an output contract), and return. One lane may change that set.

## Where things are
- Base code: lane A of the first tournament, at ccp_xstate_scratch `tourney/2026-11-03-context/A-minimalist`
  (23c3290). Read `packages/engine/src/actors.js` (writtenBrief, contextOf, roleOf, roleLines, DATA_RULE),
  `workflows/quick-fix.json`, `workflows/feature.json`, `workflows/research.json`, and
  `packages/engine/test/tourney/` (12 scenario tests Q1-Q9, F1, F2, R1, plus prompts.test.js and world.js).
- Lane A's design: `/mnt/project-files/design-tournament/A-minimalist/design.md` and `round2.md`.
- The critique this answers: `/mnt/project-files/stage-critique/report.md` (14 ranked fixes, per-stage findings) and
  the stage packets `/mnt/project-files/stage-critique/laneA-{brief,build,verify}-1.json` (what lane A's agents get
  today).
- The first tournament's pack (hard constraints and primitive kinds): `tournaments/2026-11-03-context/pack.md` in
  ccp_xstate.

## Hard constraints
- Everything in the first tournament's hard constraints still holds (Node 22+, zero runtime deps except xstate,
  replayable journal, effects only on the owner host, verifier independent of the builder).
- All 12 scenario tests in `packages/engine/test/tourney/` still pass, unchanged except where a test asserts prompt
  wording that the contract moves (say which, and why, in deviations).
- Prompt wording lives only in the workflow JSON. Engine code may keep only the renderer's fixed frame: part
  headings, the data rule, and the return mechanics.
- A workflow whose model stage is missing a required part refuses to load (a load-time check, with a test).
- The data rule and the limits are fixed, always rendered, and stated to outrank the task.
- The brief stage's output fills the next stage's task part. It is never the whole prompt of another agent.
- Verify returns one result per Expect line (line, PASS or FAIL, evidence); the host refuses a verify result that
  leaves any Expect line uncovered.
- No change to ccp_xstate main, no push, no PR. The running session pushes lanes.

## Contract tests (each lane adds these as runnable node --test files under packages/engine/test/tourney/)
- P1 Missing part refuses to load: a workflow with a model stage lacking a required part throws at load.
- P2 No prompt wording in engine code: every rendered prompt's wording traces to the workflow JSON or the renderer's
  fixed frame (the test may compare rendered text against the JSON and a short frame allowlist).
- P3 Fixed parts always present: every rendered prompt for brief, build and verify carries the data rule and the
  limits, ahead of the task.
- P4 Brief fills task only: the build and verify prompts contain the brief agent's text only inside the task part,
  with role, inputs, limits, output and return still rendered from the workflow.
- P5 Verify covers every Expect line: a verify result missing one line is refused by the host; one with every line
  is accepted.
- P6 Inputs carry meaning: every input rendered to an agent comes with its meaning, including null retry inputs
  (verdict, failure, previous) on a first build.

## Measures
1. Scenario tests Q1-Q9, F1, F2, R1 passed (`node --test packages/engine/test/tourney/*.test.js`).
2. Contract tests P1-P6 passed.
3. Weighted primitives, counted with the first tournament's kinds. New in this tournament: each stage part and each
   field attribute (meaning, trust, ...) counts as one spec convention; the renderer counts as engine code, not a
   primitive; a change to spec.js or host.js still counts double per feature.
4. Prompt wording left in engine code: bytes of string and template literals of five or more words in
   `packages/engine/src/**/*.js` (comments excluded), from measure.mjs.
5. Critique fixes 1-14 from report.md: each marked fixed by construction, partly fixed, or not fixed, with a file and
   line as evidence.
6. Spec size: pretty-printed JSON lines of the three workflows (from measure.mjs).
