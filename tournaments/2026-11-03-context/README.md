# Tournament 2026-11-03-context

Question: what passes between states, and what primitives make the work provably done, while staying simple and
expressive? Four independent designers (A-D) and a control (E, the "option A" from the six-round context-design
challenge), each built and tested by an executor, judged blind.

- `pack.md`: the frozen problem, 12 scenarios and scoring (base: ccp_xstate main 5633401)
- `result.md`: the final judge's result (A won 12/22 = 0.545; E last at 0.293)
- `lanes/<lane>/`: each designer's `design.md` (and the deletion round's `round2.md`)
- `runner.js`: the workflow script that ran it (prompts inline; to be split into scripts/tournament/)
- `viewer/`: the comparison page source (published: https://claude.ai/artifact/CJtqBqa4vV6cKuVbB3uhfJ)

Lane code: branch `tourney/2026-11-03-context/<lane>` in this repo, one draft PR each into
`tourney/2026-11-03-context/base`. Tests: `node --test packages/engine/test/tourney/*.test.js`.
These branches are a record, never merged.
