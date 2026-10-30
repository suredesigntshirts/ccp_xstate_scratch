# env-bootstrap's fresh-project line moves to after_landing

**Date:** 2026-10-30
**Decided by:** a replan thread, at the coordinator's request (two-way door; the person was away)

## The problem

env-bootstrap's Expect line `fresh-project` asked that, in a fresh thread of the v2 project after the setup sitting,
the first session journals a fingerprint whose plugin version equals the latest release, and a passing self-check.
That can't be MET before merge:

- The environment's stub runs `setup.sh` from main's clone, so a fresh thread can't run the PR's setup until it
  lands.
- The release tag `harness-v0.1.0` can only go on main after merge, so "equals the latest release" has nothing to
  equal.

The verdict gate needs every Expect line MET at the head sha, so PR #15 could never merge: a deadlock built into the
contract, not a fault in the build. Its verifier said as much (`verify/env-bootstrap/verdict.json` on that branch).

## The change

- `fresh-project` leaves Expect and becomes an `after_landing` line, with this file named in it.
- A new Expect line `real-session` (proof `world`) takes its place. It asks for what can be shown before merge: a
  real Claude Code session, with a fresh HOME set up by the PR's own `setup.sh`, loads the installed copy as a plugin
  and journals one fingerprint (version and commit matching the copy's `release.json`) and a self-check where every
  check but the release one passes. The item still needs a `world` line (`plan/check.mjs` refuses a ready build
  item without one), and this one keeps the real platform in the proof. PR #15's verifier already ran exactly this.
- The s0 gate `fresh-install` now says the fingerprint's version equals the latest `harness-v*` release and the
  self-check passes, and that a session other than the writer reads the rows. Before, it only asked for the rows,
  so the moved check would have been weaker at the gate than in the item.
- `clean-room-install-test`'s non-goal now points at `fresh-install` instead of "the stage gate's fresh-project
  run".

## Why this is safe

The proof isn't dropped, it moves to where it can happen: the stage can't pass until a real new thread shows the
released version. What's lost is that env-bootstrap is marked done before that thread exists. If the fresh thread
then fails, that's a stage-gate failure on a merged item, handled as a follow-up fix, which is cheaper than an item
that can never merge.

## How the PR names itself

This PR has no `Item:` line and its branch doesn't end in an item id. Naming `env-bootstrap` would make the verdict
gate demand that item's verdict here. The gates already pass a plan-only PR that names no item
(`plan/decisions/2026-10-30-repo-skeleton-gates.md`), and the `replan` label lets it change a contract.
