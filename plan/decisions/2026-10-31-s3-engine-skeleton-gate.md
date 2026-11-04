# s3 skeleton-runs: judged 02:35Z, passed

**Date:** 2026-10-31
**Decided by:** the engine-toy-run thread, as the coordinator asked (two-way door; the person was away)

The gate (`plan/stages/s3-engine-skeleton.md`, id `skeleton-runs`): "A toy issue runs through the first workflow with
no manual reporting by agents". Its `how`: "The journal shows every transition with its source; tests replay it".

## What the thread found

- **Every transition with its source.** toy-v1 (`/mnt/project-files/toy-run/harness/journal/items/toy-v1.jsonl`,
  copied to `verify/engine-toy-run/evidence/`) has six applied transitions: the filing (`claude-code`, the driver
  session's own `bin/host.js start`), three completions the return hook checked (`harness`), the person's card tap
  (`hearth`, the card id) and the merge effect's completion (`engine`). No agent sent a lifecycle event: the driver
  only typed `ccp-run <run>`, and agents reached the item only through the return tool's checks.
- **Tests replay it.** `restore()` replays an item's journal and refuses any transition whose recorded snapshot hash
  differs; on the live toy-v1 file it replays all six to `done`. `verify/engine-toy-run/toy-run.test.mjs` (the
  verifier's, 7 tests) checks the sources, the merge sha and the journal against the transcripts from committed
  evidence; `packages/engine/test/replay.test.js` covers replay in general. No committed test replays the toy file
  itself through `restore()`; first-real-issue can add one when it has a real item file.
- **Independent check.** The engine-toy-run verifier (Sonnet, its own rerun from a fresh issue) marked all three
  Expect lines MET at 3a60e56; PR #43 merged with ci and verdict green.

## The judgment

`skeleton-runs` is **passed**, so stage s3 is passed. One reading is stated plainly: the filing row's source is the
filing session, not a wake, completion or timer; engine-host decided filing is the session's own act, and the
verifier judged it the same way.

Per the project instructions the autonomous build stops here, after the toy run. Next in order is first-real-issue
(stage s4), which waits on the person choosing the product repo (waiting-for-person.md).
