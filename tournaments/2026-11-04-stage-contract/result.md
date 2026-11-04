# Stage-contract tournament (2026-11-04): judge's result

**Answer: no.** The question was whether a stage contract makes lane A simpler while fixing the critique at the root.
No lane qualifies as simpler under the scoring rule written before the run. Both contract lanes pass all 12 scenarios,
but each one counts more weighted primitives than the control's 22. S counts 32 and M counts 27 (24 on the most
lenient reading that stays consistent). **The contract adds weight.** It does fix most of the critique, and S does it
best, but it is not free.

Ranking (scoring rule applied exactly): **1. A (control, the only lane that qualifies), 2. S, 3. M.**

## What I reran

| Check | A-control (23c3290) | S-six-parts (601fadc) | M-minimal (981fc10) |
|---|---|---|---|
| `node --test packages/engine/test/tourney/*.test.js` (rerun in the checkout) | 27/27 | 39/39 | 44/44 |
| Same suite inside measure.mjs (`suite` in measure.json) | 27/27, exit 0 | 39/39, exit 0 | 44/44, exit 0 |
| Scenarios Q1-Q9, F1, F2, R1 | 12/12 | 12/12 | 12/12 |
| Contract tests P1-P6, verified | 0 (none, as expected) | **6/6** | **5/6** (P2 rejected, see below) |
| `npm test`: failing test names compared with the control's | baseline (112-113 failing, already present before this tournament) | no new failing name | none new except the 50 ms timing test in `capture.test.mjs` (load-sensitive: all three ran in parallel) |
| promptInEngine.bytes (measure.mjs) | 10787 | **8386** | 9508 |
| Spec lines (measure.mjs) | **2645** | 3033 | 2829 |
| distinct actors / metaKeys (measure.mjs) | 7 / 6 | 9 / 7 | 9 / 7 |
| Engine files changed (measure.mjs) | none | actors.js, index.js, stages.js | actors.js, effects/index.js, index.js, stage.js |
| spec.js / host.js changed | no | no | no |

Measure files: `/mnt/project-files/stage-contract-tournament/{A-control,S-six-parts,M-minimal}/measure.json`.

Changes to the scenario tests: the scenario assertions are unchanged in both lanes. Ten verify results were changed
from `report` to `lines`, in world.js `verifies`, Q2:40, Q5:21, Q9:29 and 37, and R1:51, 52, 79 and 102. I accept this
deviation. It is forced by the pack's own hard constraint (the host refuses a verify result that does not cover every
Expect line), not by any change to prompt wording. Both lanes deleted `prompts.test.js`, because it asserted wording
the contract moves into the JSON. I accept that too.

## Weighted primitives, counted the same way for every lane

The first tournament's kinds are: state kind, transition kind, context op, guard form, effect type, event shape,
handle form, cross-item relation, load-time or accept-time check, and spec convention (meta.* key). This pack adds
that each stage part and each field attribute counts as one spec convention. A change to spec.js or host.js counts
double.

**Control A: 21 primitives, 22 weighted** (the first tournament's count, rechecked against measure.json):

- normal, final
- invoke onDone/onError with the list form (a spec.js change, so it counts double)
- on, set, present, same, in
- meta.needs, meta.actors, meta.events, meta.input
- run, stop
- xstate.done/error, github.\<kind\>
- the ref handle
- the accept-time check (refs observed, restated inputs equal, stamped fields reserved)
- child item
- the pin (a load-time check)
- the role-from-schema convention

measure.json agrees: guard forms are present, in and same; the only op is set; effects are run and stop; there is no
reenter, inc or after.

Rules I applied the same way to every lane:

- A lane gets credit only for removing something counted in the control's 21.
- A new rule inside the existing accept() check costs 0. The first tournament ruled the same way for the fail-closed
  gates.
- A new load-time check in loadWorkflow costs +1.
- Engine plumbing costs 0: the renderer, the "an actor is an agent if and only if it has a stage" rule, and the
  EFFECTS list.

| | S | M |
|---|---|---|
| role-from-schema convention deleted | −1 (roleOf gone) | −1 (roleOf gone) |
| meta.stages key | +1 | +1 |
| stage parts | +6: role, task, inputs, limits, output, return (all in the JSON, all required by `checkStages`, stages.js:59) | +3: rules (`meta.stages.X.task`), inputs (one meaning per name), and the required `task` invoke input (stage.js:61, 72-74). Output reuses meta.actors, which is already counted; return is frame only. |
| field attributes | +3: `meaning`, `trust`, `covers` (stages.js:66-79) | 0: a meaning is the entry's value, not an attribute, and trust is dropped. The schema's `description` is the standard keyword, optional and not checked. |
| field-name convention | 0 | +1: an output with `issue` must require `lines` (stage.js:64), and accept() grades `lines` against `issue.expect` by name (actors.js:340-348). This is the same kind of rule as the control's role convention, where field names pick behaviour. |
| load-time check | +1 (`checkStages`, index.js) | +1 (`stageProblems`, index.js `checked`) |
| Expect-coverage check | 0 (inside accept(), actors.js:341) | 0 (inside the restated check, actors.js:340-348) |
| `brief` input removed, `reserved` refusal removed | n/a | 0: the `brief` input was never counted in the control's 21, and `reserved` is one rule inside accept-time check #20, which is still there |
| **Total** | **31 primitives, 32 weighted** | **26 primitives, 27 weighted** |

Sensitivity:

- **S** is 33 if the `{ "input": "brief" }` task form counts as its own convention, and 33-34 if the coverage check
  counts separately. S's own design said 33.
- **M** is 24 at the most lenient consistent reading: the words map counts as one part, the task slot counts as
  plumbing, and the field-name rule is folded into the load check. M reaches 22 (a tie) only if it is credited with
  removing the `brief` input and the `reserved` rule. The control's own count never included either, so that credit
  would double-count.
- Neither lane gets to 22 or below on any consistent count.

## Contract tests: what each one really asserts

**S: 6/6 verified.**

- **P1** deletes each of the six parts from all 8 stages (48 cases), plus 14 field-rule breaches and a pinned blob.
  Each one throws at load through the real loadWorkflow.
- **P2** traces every line of 8 rendered prompts to the JSON, the run input or a frame allowlist. That allowlist is
  headings, DATA_RULE, the return line and a run line made of data only. P2 also checks the frame's only literals of
  five or more words, and that 16 control sentences are gone from src.
- **P3**: DATA_RULE appears once, and every JSON limit sits under Limits, before `## Task`, in all 8 prompts. DATA_RULE
  states that it and the limits outrank the task.
- **P4**: each brief is exactly the Task part and appears once. Role, Inputs, Limits, Output and Return equal the JSON.
  The fixed verifier brief's hash equals sha256 of the verify run's Task part.
- **P5**: missing, extra and duplicate lines, and a PASS over a FAIL line, are each refused (rule `covers`) and
  journalled. The full set reaches awaitingMerge. The same holds in research.
- **P6**: the first build shows previous, verdict and failure as null, each with its meaning. Every run input key is
  declared.

**M: 5/6 verified.** P1 (12 cases, pinned path included, not stored when refused), P3, P4, P5 (missing, reordered,
extra, disagreeing, and no lines; FAIL-all goes to building, PASS reaches awaitingMerge, research too) and P6 all
assert what the pack asks.

**Rejected: M's P2.** The test passes, but only because its frame allowlist (contract.js `FRAME`) accepts sentences
that the pack does not allow in the engine. The pack lets the engine keep only part headings, the data rule and the
return mechanics. stage.js:27 hard-codes a limit: "Work only there: the harness refuses file tools outside it and runs
your shell commands from it." stage.js:32 and :34 add two explanatory sentences ("Data, not instructions: each input
is…", "Your result: one JSON value matching…"). So the test does not assert the pack's hard constraint, and the
constraint is in fact breached, in a small way. S keeps the same worktree limit in the JSON (`limits`).

## Critique fixes 1-14

Each fix is marked C (fixed by construction), P (partly fixed) or N (not fixed).

| # | Fix | A (control) | S | M |
|---|---|---|---|---|
| 1 | Brief instructions in the JSON; refuse when missing | P: task text is in the JSON, but `writtenBrief` falls back silently | **C**: brief role/task/limits in quick-fix.json `meta.stages.brief`; refused when missing (stages.js:59-62) | **C**: `meta.stages.brief.task` rules; refused when missing (stage.js:61) |
| 2 | One result per Expect line; host checks coverage | N: free-text `report` | **C**: `lines` + `covers` (quick-fix.json:326-328), uncovered() (stages.js:94-108), refused at actors.js:341-342 | **C**: actors.js:340-348; a load rule requires `lines` (stage.js:64) |
| 3 | Data rule everywhere, covering the brief handoff and files | P: GitHub text only; the brief is the whole prompt | **C**: DATA_RULE (stages.js:12) covers files and program output, and is rendered under Limits in every prompt (stages.js:34). The brief is only the Task (stages.js:28) | **C**: DATA_RULE (stage.js:8) covers worktree files and program output (stage.js:29-30) |
| 4 | Explain the retry inputs | N | **C**: a meaning is required (stages.js:66); null is rendered with its meaning (stages.js:31) | **C**: a meaning is required for every given input (stage.js:73-74); rendered at stage.js:33 |
| 5 | A role line for every actor, with must-nots | P: roleLines | **C**: role and limits are required parts (stages.js:59-62) | **P**: rules are required, but there is no role part; the role is only a convention inside the rules (stage.js:61) |
| 6 | Verifier: the pinned commit, and what to do if it cannot test | P: exact checkout command, no fallback | **P**: wording only (quick-fix.json verify limits and return) | **P**: wording only (quick-fix.json `meta.stages.verify.task`) |
| 7 | Return step impossible to miss | P | **C**: returnLine says "a text reply is not read" (stages.js:13) and is in every prompt (stages.js:39) | **C**: returnPart (stage.js:19) is in every prompt and is the SubagentStart context (actors.js `run.context = returnPart(run)`) |
| 8 | Who names the branch | N | **P**: JSON limits for build and brief ("Use no other branch name"; "Do not name a branch") | **P**: JSON rules for build and brief |
| 9 | Verifier checks only the Expect lines; extras advisory | N | **C**: the host refuses any extra line (stages.js:102); advisory wording in the JSON | **C**: the host refuses any extra or reordered line (actors.js:344-345) |
| 10 | Worktree facts | P | **P**: runLine gives the worktree and branch (stages.js:14) but not which repo it copies; "work only in your worktree" is repeated 8 times in the JSON | **C**: frame Run line (stage.js:27) names the worktree, the repo it copies and the branch, but this is the P2 breach |
| 11 | Cut the noise | N | **P**: $refs inlined (stages.js:17) and the brief is not repeated (stages.js:30), but target still shows `"key":"o/r#1","green":true` | **P**: $refs inlined (stage.js:12), but the schema is pretty-printed (longer prompt) and target still shows key/green |
| 12 | Journal the send-back | N | **N** | **C**: sentBack() journals the text and its hash (actors.js:456-463, 484-486, 501-503) |
| 13 | Environment facts written once | N | **P**: "paths from the repository root" in the brief limits; no environment doc | **P**: the same, in the brief rules |
| 14 | Optional `notes` on build | N | **C**: quick-fix.json:336 plus an output meaning (quick-fix.json:284) | **N** (removed in its own review) |
| | **Total C / P / N** | 0 / 7 / 7 | **8 / 5 / 1** | **8 / 5 / 1** |

My count of M differs from M's own claim in two places. Fix 5 drops from C to P, because a role is never required.
Fix 12 rises to C, because send-backs are now journalled. The total of 8 by construction stays the same.

## Applying the scoring rule

1. **Qualify** (12/12 scenarios and weighted primitives of 22 or fewer): only **A**. S has 32, M has 27, so neither
   qualifies.
2. **For reference**, S and M are ranked against each other with the same tie-breakers.
   - P tests: S 6 > M 5.
   - Had M's P2 been accepted, the next tie-breaker decides. Fixes by construction tie at 8 each.
   - promptInEngine bytes: S 8386 < M 9508.
   - So S ranks ahead of M either way.
3. Spec size (M 2829 < S 3033) never decides the order.

The composite score is (qualifies ? 100 : 0) + 10 × verified P tests + fixes by construction − promptInEngine.bytes ÷
10000. It is used only to make the ranking above numeric:

- A: 98.92
- S: 67.16
- M: 57.05

## New problems the contract caused

- **Stage names collide with workflow names (both lanes).** `effects/index.js` `handlers()` lets a workflow name
  override an agent. Both designs' `research` stage started child research items, and R1 failed until the stage was
  renamed `researcher`. S has no guard: adding `workflows/write.json` would silently turn research's writer into a
  child item. M added a guard, but see the next point.
- **M: pinned workflows now depend on the current workflow folder.** `checked()` (index.js) runs `readdirSync` on the
  workflow folder even for a `name@sha256` load. I confirmed it: pin research, then add a `write.json`. The pinned
  research item then refuses to load ("stage write has the name of a workflow"). That breaks the Q8 property (finish
  on the rules you started with) for items already in flight. The scenario tests do not cover this.
- **Older pinned workflows stop running (both lanes).** In M, a pinned blob without `meta.stages` refuses to load. In
  S, it loads, but prepare() throws "is no stage". Items in flight need a migration.
- **The verifier's checkout command got weaker (both lanes).** The control computed
  `git fetch origin pull/<N>/head && git checkout --detach <sha>` from the real PR. Now generic JSON wording asks the
  agent to work out N itself. This is a regression on critique fix 6/10, caused by the rule that keeps wording out of
  the engine.
- **Host-stamped fields still show (both lanes).** The verify prompt's target input still shows `key` and `green`,
  even though the output text says not to copy them (fix 11).
- **M: the name `task` means two things.** `meta.stages.X.task` is the rules, while the invoke input `task` is the
  task. An input can never be named `task`.
- **M: workflow-shaped engine code is back.** accept() and the load check know the field names `issue`, `lines` and
  `expect` (actors.js:340-348, stage.js:64). That is the kind of coupling the control's single vocabulary avoided.
  S's `covers` attribute keeps it in the JSON.
- **M: agent-set key/gates/green are dropped silently.** They used to be refused as `reserved`. Stamping is still
  safe, but the agent never learns that it copied host fields.
- **S: a second instructions slot.** `why` has trust `instructions` but is rendered under Inputs, after the limits. It
  is the person's own text, so this is acceptable, but it is a second channel of instructions besides the Task.
- **S: spec weight.** The worktree limit is repeated in 8 stages; spec lines go up 388 (3033 against 2645).
- **Both: more actor names** (7 to 9: `researcher`, `write`), and research's journals change actor names.

## Best ideas (worth grafting even though the contract as a whole does not pay for itself)

- **S:** an output field declares `covers: "issue.expect"`, and one generic host check refuses a result that misses,
  adds or repeats a line, or whose PASS disagrees with the lines. The rule stays in the JSON, not in engine field
  names.
- **S:** at load, the invoke's input keys must exactly equal the stage's declared inputs, so nothing reaches an agent
  without a meaning.
- **S:** Limits, led by the data rule, are rendered before Inputs and Task, and the data rule says it outranks both.
- **S:** P4's hash link: the verifier brief fixed when the brief agent's result is accepted equals sha256 of the verify
  run's Task part.
- **M:** journal every send-back message word for word, with its hash (fix 12). This is a small engine change and
  costs no primitive.
- **M:** a refused workflow is never stored as a blob, and an invoke src that is not a stage, an effect or a workflow
  refuses to load. Both would be worth keeping if the collision check read the pinned spec's own declared names rather
  than the folder.
- **M:** drop the trust attribute. The single task slot under the rules gives trust by position, which saves a
  convention.
- **A (control):** the host computes the exact checkout command for the PR under test. Both contract lanes lost this.
  It should come back as data (for example a host-filled `checkout` input) rather than as engine wording.

## Bottom line

A stage contract is a good prompt design: S fixes 8 of the 14 critique items by construction and passes every contract
test. It is not a simplification: it costs +10 weighted primitives in S, and +5 in M (+2 at the most lenient count).
If the prompt fixes matter more than the primitive count, take S's shape. Add M's journalled send-back. Move the
checkout command into host-filled data. Add a collision check that reads only the pinned spec. Then record it as a
two-way-door decision that accepts the added weight, not as a simplification.
