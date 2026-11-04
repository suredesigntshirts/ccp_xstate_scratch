# Releases as branches, and the PR gates run in the thread, while Actions can't run

**Date:** 2026-10-30, 16:40Z
**Decided by:** the self-update-by-version thread, at the coordinator's request (two-way doors; the person was away)

## What changed

- The person said GitHub Actions minutes for private repos are used up (16:28Z). The last ccp_xstate runs were at
  12:19Z; pushes after that started none.
- The git proxy drops tag pushes from threads (12:12Z, and again 16:31Z on the scratch repo) and ref deletions, but
  lets branch pushes through (16:31Z: `release/probe-ref` pushed to the scratch repo, then couldn't be deleted).

## Decisions

1. **A release is `harness-v<x.y.z>` as either a branch `release/harness-v<x.y.z>` or a tag.** The merging thread
   pushes the branch with `node scripts/release/release.mjs branch --push`; `.github/workflows/release.yml` makes a
   tag when Actions runs. Readers take both as one series by version. self-update-by-version's `release` line and
   the s0 `fresh-install` gate now say so. The quick-fix thread's research reached the same answer. The person can
   also publish a GitHub release in the web UI for a real tag.
2. **While Actions can't run, the merging thread runs the gates itself at the PR's head sha**: `npm test`,
   `node plan/check.mjs`, and `node scripts/gates/pr-gate.mjs stubs|freeze|verdict` with `BASE_SHA`, `PR_BRANCH`,
   `PR_BODY` and `PR_LABELS` set as the PR has them (docs/gates.md). It pastes the commands and their output in a
   PR comment before merging. This is weaker than CI (the builder's own run), so the verifier's verdict, committed
   from another session, stays the check that counts. When Actions runs again, CI is the rule again.

Getting Actions back (minutes, or making the repos public) is in `waiting-for-person.md`.

## Correction, 16:46Z

Actions was not out of minutes in ccp_xstate. No runs started on PR #19 from 12:19Z to 16:30Z because the PR had a
merge conflict, and `pull_request` workflows don't run on a conflicted PR. Once the conflict was resolved, `ci` and
`verdict` ran at 16:37Z, and on PR #19's merge (7d6b0b4) `release.yml` tagged `harness-v0.1.0` while this thread
pushed `release/harness-v0.1.0`, both at the same sha. So CI stays the merge rule, and decision 2 applies only when
a PR's workflows really can't start (for example if the minutes do run out). Decision 1 stands: threads still can't
push tags.
