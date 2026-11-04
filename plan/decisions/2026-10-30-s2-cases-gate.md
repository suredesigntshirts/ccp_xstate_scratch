# s2 cases: judged 19:30Z, passed

**Date:** 2026-10-30
**Decided by:** the s1/s2 gate thread, at the coordinator's request (two-way door; the person was away)

The gate (`plan/stages/s2-workflow-model.md`, id `cases`): "Tests for C-verdict-on-old-head, C-push-after-pass and
C-second-fail-replans pass on the ported workflow". Its `how` is `npm test`.

## What the thread found

On main at a6057a1 (the obs-page merge; 1279248 only adds a status change), after `npm ci`:

- `npm test`: 259 tests, 259 pass, 0 fail.
- `node --test packages/engine/test/cases/*.test.js`: 16 pass, 0 fail. Four tests for C-verdict-on-old-head, three
  for C-push-after-pass, five for C-second-fail-replans, each with a control where the case has one.
- `verify/wf-quick-fix/cases.test.mjs` (the item verifier's own tests for the same three cases) pass inside `npm test`.
- The tests drive `workflows/quick-fix.json` through `packages/engine` on xstate 5.33.3, the version
  `packages/engine/package.json` pins, by sending events to the machine and reading the next state: pure
  transitions, no actors run.
- What each case asks (`plan/cases/work-item.md`) is what its tests assert: a PASS for A while the head is B can't
  reach merging and the stale verdict is recorded; a push in awaitingMerge goes back to verifying for B; a second FAIL
  goes to replanning, waits for a written why and starts no third build.

## Independent read

A Sonnet subagent, given the sources and no conclusion, read the stage, the cases and the tests, ran both commands,
and returned `s2: PASS`.

## The judgment

The gate `cases` is **passed**, so stage s2 is passed. wf-quick-fix is `done` (it merged
as #14 with all four Expect lines MET; PR #27 set it at 19:28Z).
