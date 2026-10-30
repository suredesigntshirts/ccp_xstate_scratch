# s0 fresh-install: first check, 12:13Z, not passed

**Date:** 2026-10-30
**Decided by:** the fresh-install check thread, at the coordinator's request (two-way door; the person was away)

## What the thread found

The coordinator started this thread at 12:13Z, one minute after the plugin was installed in the project
(`/mnt/project-files/harness/install.json`: release 0.1.0, tag `null`, commit 08f4723, written 12:12:42Z).

- `/tmp/env-manager.log` shows `session_mode: resume-cached` and "Skipping initialization script for faster
  startup". So `infra/cloud-environment/setup.sh` did not run in this container.
- `~/.claude/skills/ccp-harness` does not exist, and the session loaded no `ccp-harness` plugin.
- `/mnt/project-files/harness/journal/sessions/` is empty: no fingerprint row and no self-check row from any
  session.
- No `harness-v*` tag exists (`waiting-for-person.md`, PR #17).

## The judgment

The gate is **not passed**, and this thread did not try to make it pass:

1. "A new thread in the v2 project installs the plugin" means the thread's own container ran `setup.sh` at boot.
   A thread that installs the copy by hand (git archive plus `scripts/install.mjs`, the workaround the
   env-bootstrap thread used) proves the copy works, not that a new thread gets it. So a hand install doesn't
   count, and this thread didn't run `setup.sh` either (it was refused as Self-Modification before).
2. Even with the rows written, "the fingerprint's plugin version equals the latest harness-v* release" can't hold
   while no tag exists: the self-check's release check reads `unknown`. The gate is not relaxed to accept
   `unknown`; the check stays as the replan wrote it (`2026-10-30-env-bootstrap-fresh-project-after-landing.md`).

## What happens next

- The coordinator starts another new thread. A resume-cached container is the platform's choice, not the plan's;
  the 11:35Z rerun thread got a `new` container right after the setup script was re-saved.
- The gate can pass only after the tag exists, so the useful order is: tag (or the release workflow from
  `self-update-by-version`), then a new thread whose log shows the setup script ran, then a second session reads
  its two rows.
- A thread that lands in a resume-cached container reports it and stops; it doesn't patch its own settings.
