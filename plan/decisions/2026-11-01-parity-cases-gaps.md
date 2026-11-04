# parity-cases: name the cases the engine doesn't meet, with a fix item each

2026-11-01, decided by the build thread as the person's stand-in (two-way door: plan-only, undone by a replan).

**Situation.** parity-cases asks for a host-driven test per case and "all pass", with the non-goal "no new behaviour;
a failing case becomes its own fix item". Reading the engine at main (5160cdb) against the 17 cases, four are not
met:

- **C-finish-closes-waits.** Leaving a state that asked turns the ask run into a `stop` effect (`host.js`
  effectsOf), but `effects/index.js` has no `stop` handler, so the person's card stays up; a tap on it later finds no
  run and does nothing. quick-fix also takes no event for its PR merged by another path.
- **C-waiting-does-not-stall.** Items are separate files, so another item advances; but quick-fix's `awaitingMerge`
  and `replanning` set no timer, so nothing schedules a wake for the waiting item.
- **C-builder-cannot-change-own-workflow.** `bin/host.js` loads `workflows/<--workflow>.json` on every call, and
  `restore` checks only that replay reaches each recorded snapshot hash; no workflow name or file hash is pinned at
  filing, so a changed file that replays the same is run.
- **C-two-hosts-one-item.** Another session's host turns the item's events away (`not-owner`, in its own session
  file), but `offer()` first runs every open effect of the item whoever owns it. A non-owner host posted the owner's
  pending card and wrote the effect rows into the owner's file, and an owner and another host restored together
  posted it twice (probe on the build branch, 2026-11-01).

**Choice.** parity-cases is built now with a test for each of the 13 met cases, and lists the four above in
`packages/engine/test/parity/gaps.json`, each naming its fix item (`fix-finish-closes-waits`, `fix-waiting-wake`,
`fix-workflow-pinned`, `fix-other-host-runs-effects`, drafts in s5-parity). The listing test fails on a case with neither. Each fix item adds its
case's parity test and removes its gaps entry. parity-compare waits on them, so the s5 gate ("every live case has a
passing test") closes only when all four land.

**Rejected.** Building the fixes inside parity-cases (its non-goal forbids new behaviour, and one PR would mix four
behaviours with the harness of tests); holding parity-cases until the fixes are built (the 13 tests are useful now,
and the fix items need the parity harness to prove themselves); marking gap tests skipped (CI's no-stubs gate refuses
skipped tests, rightly).

**Also noted.** No real wake has shown how the platform reports a push to a PR (the fixtures hold check runs, a check
suite and a merge). C-push-after-pass offers `pr.pushed` with a github source, as the host takes it today. Recorded as
a risk on parity-cases for parity-compare, not a gap.

Also found: a start refused for missing Expect lines leaves its refused row in the item's file, so `persist` later
finds the file and the same item id can never start, even with Expect lines (the host takes the file as another
session's). The case is met (it fails closed), so this is a risk on parity-cases for parity-compare, not a gap.

**Outcome (2026-11-01 11:16Z).** parity-cases merged (PR #59, verdict all five MET at 85de49c by a separate verifier
subagent). 13 cases pass through the host; the four above stay in `gaps.json`. The verifier's
`verify/parity-cases/*.gap.test.mjs` assert today's behaviour for each gap, so each fix item deletes its own one with
its gaps entry. The s5 cases-pass gate is not passed until the four fix items land.
