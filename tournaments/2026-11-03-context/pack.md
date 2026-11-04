# Design tournament: problem pack (frozen 2026-11-03, ccp_xstate main 5633401)

## The problem
ccp_xstate is a software factory: work items move through workflows (XState JSON interpreted by
`packages/engine/src/spec.js`, hosted by `packages/engine/src/host.js`, effects in `packages/engine/src/effects/`,
agent actors in `packages/engine/src/actors.js`, wakes in `wake.js`). Agents (brief, build, verify, ask = a card to a
person, merge) do the work. A journal (`items/<item>.jsonl`, `blobs/<sha256>`) records every transition, and replay
restores state. Today there is one workflow, `workflows/quick-fix.json`.

Design question: **what passes between states, and what primitives and constraints make the work provably and honestly
done, so that initial states can be rebuilt or redone, while staying simple and expressive enough for many workflows?**

## Hard constraints
- Node 22+, zero runtime deps except `xstate` (5.x).
- State is rebuilt by replaying journalled events. Effects run only on the owner host. Nothing may depend on replaying
  an agent (agents are not deterministic).
- Every agent acts with the person's GitHub account (so anything an agent can write on GitHub can't be trusted as the
  person's word).
- Person attention is the scarcest resource: count the card taps a happy path costs.
- The verifier must be independent of the builder.

## Scenarios (the test suite; each needs a runnable test to count)
Quick-fix (issue → one PR → merged):
- Q1 Happy path: issue → brief → build → verify PASS → CI green → person approves → merged at the verified head.
- Q2 Push after PASS: the head moves after the verdict; no merge until the new head is verified.
- Q3 Red CI: a required check fails on the head; with a build left the item rebuilds carrying the failing check as a
  typed failure; with none left it goes to replanning.
- Q4 CI edited by the builder: the PR changes CI config (e.g. `.github/workflows/*`) and CI turns green; it must not
  merge on that green without the person explicitly approving a CI-changing PR.
- Q5 Verifier misreports: the verifier returns PASS naming the right sha but its worktree is at another commit; the
  verdict must not count.
- Q6 Late push from a dead attempt: after a failure-driven replan, attempt 1's builder pushes; it must not affect
  attempt 2's gates or merge.
- Q7 Merge outside the host: the PR is merged on GitHub by someone else; the item must not end as verified-done.
- Q8 Workflow changes in flight: the workflow file changes while an item waits for approval; the item finishes on the
  rules it started with and its journal still replays.
- Q9 Expect edited on GitHub: the issue's acceptance lines change mid-build (could be an agent); grading must not
  change without the person.
Feature (one goal, several PRs):
- F1 Three slices; slice 2 fails verify on every build: rounds are bounded and it escalates; slice 1's merged work is
  kept; the whole feature's acceptance is verified before it reaches main, with ≤ 1 person tap for the feature's merge.
- F2 The parent is restored on another host mid-slice: no slice is started twice.
Research (question → verified, published report; no PR):
- R1 Three parallel sub-questions, one researcher errors: the join does not hang; the report is verified against
  sources the host itself checked; it is published only after approval.

## Measures (what the judge scores)
1. Scenarios passed: only those with a runnable test that passes (`node --test <file>`), asserting the scenario's
   stated outcome.
2. Primitive count, using these kinds: state kind, transition kind, context op, guard condition form, effect type,
   event shape, handle form, cross-item relation, load-time or accept-time check, spec convention (meta.* key).
   A change to the interpreter (spec.js/host.js) is counted per feature, and each counts double.
3. Total spec size: pretty-printed JSON lines of the three workflows.
4. Person taps on Q1's happy path and on F1.
5. Expressiveness: are all three workflows written in the same primitives, with no workflow-specific code in the host?
Headline: scenarios passed per primitive, with taps and spec size as tie-breakers.

## Today's primitives (baseline, for counting deltas)
States: normal, final. Transitions: invoke onDone/onError, on, after, reenter. Context ops: set, inc. Guard forms:
present, is, in, same, below. `meta.needs` (entry preconditions, checked against the context after the transition's
actions; a failing need makes that candidate fail, so ordered candidate lists fall through). Effects: run, stop,
timer, cancel. Events: xstate.done/error.actor.*, timers, tripwire, github.<kind>. Schemas: meta.actors, meta.events,
meta.input. NOT supported by spec.js today: `always`, `#id` targets, targets that aren't siblings.

## Useful code
- `packages/engine/src/spec.js`: machineOf, transition helpers, replay, hashOf.
- `packages/engine/test/parity/world.js` and `C-*.test.js`: stubbed world (GitHub, cards, clock) and 13 case tests,
  good models for scenario tests.
- `workflows/quick-fix.json`.
