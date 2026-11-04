# s4 real-merge: judged 18:20Z, passed

**Date:** 2026-10-31
**Decided by:** the "Continue the v2 build past s3" thread, as the person's stand-in (two-way door; the person
authorized a stand-in at 02:40Z)

The gate (`plan/stages/s4-first-real-item.md`, id `real-merge`): "The issue's PR is merged at the verified commit, and
the journal holds every step". Its `how`: "GitHub plus the journal".

## What the thread found

- **Merged at the verified commit.** ccp_machine_test#105 (issue #104, jsonl-lint many files) merged 18:12:28Z as
  8dede22b, whose second parent is the PR head 32587cde. The verify actor's returned verdict is PASS at 32587cde. The
  merge was made by the host's merge effect (`fri-jsonl-lint-2:4.merge`, outcome sha 8dede22b) after the person's tap
  on the declared merge card (transition source `hearth`, the card id). No agent or stand-in call merged it.
- **The journal holds every step.** Transitions 0 to 5 each carry their source (filing, three return hooks, the tap,
  the engine effect). Of the 30 tool calls in the driver's and its three agents' transcripts, 29 have tool.call rows;
  the one without is a Bash call Claude Code refused before any hook ran, which no hook can see.
- **Independent check.** verifier-first-real-issue-2 marked all four first-real-issue Expect lines MET at f389c3c
  (`verify/first-real-issue/verdict.json`); PR #56 merged with ci and verdict green.

## The judgment

`real-merge` is **passed**, so stage s4 is passed. Two readings are stated plainly: the refused Bash call counts as a
step no hook can see, not a missing row; and run 1 (#103, merged by the stand-in outside the host) does not count, run
2 does. Defects the verifier noted (one manual nudge to the verify agent before engine-actor-returns existed, the card
wording in the thread differing from the declared question) are for s4b-widen, not blockers.
