# Tournament 2026-11-03-context

Question: what passes between states, and what primitives make the work provably done, while staying simple and
expressive? Four independent designers (A-D) and a control (E, the "option A" from the six-round context-design
challenge), each built and tested by an executor, judged blind, then a deletion round and a final judge.

- `pack.md`: the frozen problem, 12 scenarios and scoring (base: ccp_xstate main 5633401)
- `config.json`: the run as the kit describes it: base, lanes, stages, scoring, suite, measure and the runner sha
- `prompts/`, `schemas/`: the prompts and schemas from `runner.js`, lifted out unchanged
- `runner.js`: the Workflow script that actually ran, before the kit existed (prompts inline)
- `measure.mjs`: this pack's measures read from a lane checkout (spec lines, primitive tallies, interpreter files)
- `result.md`: the final judge's result (A won 12/22 = 0.545; E last at 0.293)
- `scores.json`: `scripts/tournament/measure.mjs` run on each lane branch (tests: A 27, B 19, C 22, D 22, E 22)
- `lanes/<lane>/`: each designer's `design.md` (and the deletion round's `round2.md`); E's design is
  `/mnt/project-files/context-design/options.md`, option A
- Viewer: https://claude.ai/artifact/CJtqBqa4vV6cKuVbB3uhfJ (source on the scratch base branch, `viewer/`)

Lane code: branch `tourney/2026-11-03-context/<lane>` in ccp_xstate_scratch, one draft PR each (#37-#41) into
`tourney/2026-11-03-context/base`, tracking issue #36. CI on those PRs (`tournament / score`) produces each lane's
suite results and measures. These branches are a record, never merged.
