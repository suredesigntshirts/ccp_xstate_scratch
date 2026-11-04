# s0 fresh-install: second check, 16:46Z, passed

**Date:** 2026-10-30
**Decided by:** the second fresh-install check thread, at the coordinator's request (two-way door; the person was away)

## What the thread found

The coordinator started this thread at 16:46Z, after release `harness-v0.1.0` existed as both a tag and the branch
`release/harness-v0.1.0` (self-update-by-version, PR #19, merge 7d6b0b4).

- `/tmp/env-manager.log` shows `session_mode: new` and "Running initialization script" then "Successfully executed
  init script". No "Skipping initialization script" line. So `infra/cloud-environment/setup.sh` ran at boot.
- `~/.claude/skills/ccp-harness/release.json` names version 0.1.0, tag `harness-v0.1.0`, commit 7d6b0b4.
- The SessionStart hook wrote two rows to
  `/mnt/project-files/harness/journal/sessions/session_01KfkB5JDoRrWsSin1udne7v.jsonl`:
  - `session.fingerprint`: plugin `ccp-harness` 0.1.0, tag `harness-v0.1.0`, commit 7d6b0b4, `latest_release`
    0.1.0, `allow_rules` 8, `depth` 3, container `container_01YWQz4ULbkjGvXSSQBJ9JWu`.
  - `session.selfcheck`: `passed: true`, 6 of 6 (settings, rules, depth, copy, release, journal).
- `git ls-remote` shows `refs/tags/harness-v0.1.0` (peels to 7d6b0b4) and `refs/heads/release/harness-v0.1.0`
  (7d6b0b4). No newer `harness-v*` exists.
- A second new thread started at the same time (`session_01KfkB5JWpsPCbEiHJb1AV9X`, another container,
  `container_01DUP3w8jBaougx4Fh5MwbDs`) wrote the same two rows with the same version and a passing self-check.

## How the rows were read

The gate's `how` asks for a session other than the writer. This thread ran a headless `claude -p` (Sonnet) with
its own HOME, so no plugin loaded and it wrote no rows, and with `CLAUDE_CODE_SESSION_ID` unset, so it got its own
session id (`2e333274-2f38-4cdb-91cf-ab2e6607dc7e`). It read every file under `journal/sessions/` and ran the
`ls-remote` itself. Its verdict: both sessions that wrote fingerprint and self-check rows meet the gate,
`VERDICT: PASS`. A first try without unsetting the variable inherited this thread's session id, so it doesn't
count as the read.

The reader is still a child of this thread's container and the same account (ledger L-same-account-everywhere).
The second thread's rows are the stronger evidence: neither this thread nor its reader wrote them.

## The judgment

The gate `fresh-install` is **passed**. The other s0 gate, `one-sitting`, is not judged here.

What changed since the first check (`2026-10-30-fresh-install-gate-first-check.md`): the containers were new, not
resume-cached, and a release existed. No setting was changed by a thread, and nothing was installed by hand.

## What happens next

- `waiting-for-person.md`: the "no release tag" line and the "resume-cached container" line are cleared. A
  resume-cached container can still happen; a thread that lands in one should report it, and the plugin's own
  self-check now names what's missing.
- Every new thread now starts with the plugin and journals itself, so later items can rely on the fingerprint.
