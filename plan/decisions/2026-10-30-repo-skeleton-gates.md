# How the repo-skeleton gates read a PR

**Date:** 2026-10-30
**Decided by:** the repo-skeleton thread (two-way doors; the person was away)

- **A PR names its item** with an `Item: <id>` body line, or a branch `<kind>/<id>`. Thread branches here are
  assigned by the environment (`claude/...`), so the body line is the form threads will use.
- **A PR that names no item** passes the verdict gate only if it changes nothing outside `plan/`. Code never
  merges without a verdict; decisions, research and replans don't need one.
- **The freeze ignores `status`**, so a build PR can mark its item done. An item is frozen when the PR names it or
  its status at the base is `doing` or `done`, which closes the gap of editing a started item in a PR that names
  another.
- **A verifier subagent signs as `<thread session URL>#agent=<name>`** in its `Claude-Session` trailer. The item
  asks for a verifier subagent and a different trailer from the builder; a subagent shares its thread's session,
  so this names it apart. It is convention, not proof (L-same-account-everywhere).
- **`verified_sha` is required**, and any commit after it that changes something outside `verify/` turns the gate
  red, so a merge happens at the verified head (L-merge-at-verified-head).
- **The gate code lives in `scripts/gates/`**, outside `packages/`, so the stub ban doesn't trip on its own
  patterns, and it isn't a harness library.
- **Principles in CLAUDE.md come from `plan/README.md`.** This session can't read the ccp_machine repo, so its
  CLAUDE.md was not carried over line by line; the branch rule follows the item (no `claude/` prefix).
