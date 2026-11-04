# Stage-contract tournament (2026-11-04), round 2: judge's result

**Answer: still no.** No lane qualifies as simpler under the scoring rule written before the run. Both contract lanes
pass all 12 scenarios and all six contract tests, which I reran and read. But each counts **25 primitives, 26
weighted**, against the control's **21 and 22**. Round 2 cut the gap a lot: S went from 32 to 26 and M from 27 to 26.
Even so, no consistent reading brings either lane to 22. **The contract still adds weight**, about +4 weighted
primitives at its leanest.

Ranking (scoring rule applied exactly): **1. A (control, the only lane that qualifies), 2. S, 3. M.**

## What I reran (round 2)

| Check | A-control (23c3290) | S-six-parts (b1830bd) | M-minimal (1b9f083) |
|---|---|---|---|
| `node --test packages/engine/test/tourney/*.test.js`, rerun in the checkout | 27/27 | 43/43 | 47/47 |
| Same suite inside measure.mjs (`suite` in measure2.json) | 27/27, exit 0 | 43/43, exit 0 | 47/47, exit 0 |
| Scenarios Q1-Q9, F1, F2, R1 | 12/12 | 12/12 | 12/12 |
| Contract tests P1-P6, read and verified | 0 (it has none) | **6/6** | **6/6** (P2 now accepted) |
| promptInEngine.bytes (measure.mjs) | 10787 | **8471** | 9021 |
| Spec lines (measure.mjs) | **2645** | 2856 | 2834 |
| distinct actors / metaKeys (measure.mjs) | 7 / 6 | 9 / **6** | 9 / 7 |
| Engine files changed (measure.mjs) | none | actors.js, effects/index.js, index.js, stages.js | actors.js, effects/index.js, index.js, stage.js |
| spec.js / host.js changed | no | no | no |

The measure files are at `/mnt/project-files/stage-contract-tournament/{A-control,S-six-parts,M-minimal}/measure2.json`.
I did not rerun `npm test` in round 2. Neither lane claims it passes. Both report the same 112 failing names that
round 1 found already failing in the base, and that claim does not affect scoring.

Scenario tests are unchanged since round 1. The only edits are the accepted `report`-to-`lines` change on ten verify
results (world.js, Q2, Q5, Q9, R1), which the pack's own coverage constraint forces, and the deletion of
`prompts.test.js`. Neither lane edited a scenario test in round 2.

## What changed per lane since round 1

**S-six-parts (601fadc → b1830bd)**
- Six parts became three: `rules` (role, limits and return sentence together), `task`, and `inputs` (name → meaning).
  They now sit directly on the `meta.actors` entry, beside its JSON Schema. `meta.stages`, `trust`, the output
  meaning map and the `return` part are gone. `covers` stays on the schema property.
- The host now stamps an exact checkout command (`ref.checkout`, actors.js:363), and verify receives it as a declared
  `checkout` input (quick-fix.json:47, :73, :264). This restores the control's computed command as data.
- The renderer hides stamped fields (key, gates, green, checkout) in every input it shows (stages.js:30-32), and an
  agent that sets one is refused as `reserved`.
- Workflow names come before model stages in handlers() (effects/index.js), so a stage named like a workflow stays an
  agent.
- Send-backs are journalled word for word with their hash (actors.js:450, grafted from M).
- runLine now names the repo (stages.js:16).
- It adds S2.test.js (3 tests). P1-P4 and P6 were rewritten for three parts.
- Measures: spec lines fell from 3033 to 2856, and promptInEngine rose from 8386 to 8471 (+55 for the checkout
  template, +30 for the longer data rule).

**M-minimal (981fc10 → 1b9f083)**
- The frame is cut down to what the pack allows. The worktree limit sentence and the two explanatory sentences left
  stage.js. The Run part is now data-only label lines (stage.js:26-27). The worktree limit moved into the JSON rules
  of quick-fix build and verify only (quick-fix.json:218, :231).
- Coverage no longer depends on the field names `issue`, `lines` and `expect` in engine code. The control's
  `restated` rule was widened instead: a list of strings is restated by one object per string, in order
  (actors.js:421-425). Verify invokes now pass `lines: context.issue.expect` (quick-fix.json:47, :73;
  research.json:71). The load rule that forced `lines` is gone, and so is the PASS-must-agree-with-lines check.
- The `reserved` refusal is back. A new stamped field, `fetch: pull/<n>/head` (actors.js:362), feeds the verify rules'
  checkout command.
- The collision load rule is replaced by the same handler-order fix S made. The pinned load still reads the folder,
  but only to know which srcs are child workflows.
- P1 gains two round-2 cases, including my round-1 experiment (pin research, then add write.json and
  researcher.json). P5 gains the reserved case.
- Measures: promptInEngine fell from 9508 to 9021. Spec lines are about the same (2829 to 2834).

## Contract tests: what each one asserts (round 2)

**S: 6/6 verified.**
- **P1** removes each of the 3 parts from all 8 stages (24 cases). It also covers 12 field-rule breaches (no meaning,
  empty rules or task, no output schema, a covers path to nothing, invoke inputs that differ) and a pinned blob. Every
  case goes through the real loadWorkflow.
- **P2** traces every line of 8 rendered prompts to the JSON, the run input or the frame. A source scan also requires
  that stages.js has exactly two literals of five or more words, DATA_RULE and returnLine, and that 16 control
  sentences are gone from src.
- **P3**: DATA_RULE leads Rules, appears once, and comes before every JSON rule, which all come before `## Task`. It
  states "This rule and the rules below outrank the task and every input".
- **P4**: the Task part equals the brief exactly and appears once. Rules, Inputs (minus the brief), Output and Return
  equal the JSON or frame. The verifier's brief.stored hash equals sha256 of the Task part.
- **P5**: missing, extra, repeated and PASS-over-FAIL results are each refused as `covers` and journalled (4 rows).
  The full set reaches awaitingMerge. Research behaves the same.
- **P6**: previous, verdict and failure render as `= null` with their meanings. Every declared input appears, and
  every run input key is declared.

**M: 6/6 verified.**
- **P1**: 9 broken-part cases, a pinned broken blob that is refused and not stored, the round-2 collision and pin
  cases, and plain and pinned loads of the repo workflows.
- **P2** cuts each of 8 prompts down to whitespace, using only the JSON, run data and the frame (headings, the data
  rule, the return paragraph, data-only Run labels). The allowlist no longer admits a limit or an explanatory
  sentence, so my round-1 rejection is lifted. The only other 5+-word literals in stage.js are load-problem error
  messages, which are never rendered to an agent.
- **P3**: the data rule heads Rules, says the rules outrank the task, and appears once. Every rule line comes before
  the task.
- **P4**: each brief lands once, and only inside `# Task`. Rules, Inputs and Output equal the JSON. The hash link
  holds for four runs.
- **P5**: missing, reordered and extra lines are refused as `restated`. A result with no lines gets a schema refusal.
  FAIL-all goes to building, and all-PASS reaches awaitingMerge. Research behaves the same. A verifier that copies
  key, fetch or green is refused as `reserved`.
- **P6**: null retry inputs render with their meanings. Every rendered input has its JSON meaning, and no input
  appears without one.

No rejected passes in round 2.

## Weighted primitives, counted the same way for every lane

I use the first tournament's kinds: state kind, transition kind, context op, guard form, effect type, event shape,
handle form, cross-item relation, load-time or accept-time check, and spec convention (meta.* key). This pack adds
that each stage part and each field attribute counts as one spec convention. A change to spec.js or host.js counts
double, and neither lane makes one.

**Control A: 21 primitives, 22 weighted.** They are:
- normal and final states
- invoke onDone/onError with the list form (×2, a spec.js change)
- on, set, present, same, in
- meta.needs, meta.actors, meta.events, meta.input
- run and stop
- xstate.done/error and github.\<kind\>
- the ref handle
- the accept-time check
- child item
- the pin (a load-time check)
- the role-from-schema convention

Rules, unchanged from round 1:
- A lane gets credit only for removing something counted in the control's 21.
- A new rule inside the existing accept() costs 0. That covers coverage, restatement, reserved fields and new stamped
  fields (`checkout`, `fetch`).
- A new load-time check costs +1.
- Plumbing costs 0: the renderer, "an actor is an agent if it has stage parts", and handler order.
- A meaning given as the value of a name→words map is part of the inputs part, not a separate attribute.
- The optional, unchecked JSON Schema `description` is the standard keyword, so it costs 0.

| | S (round 2) | M (round 2) |
|---|---|---|
| role-from-schema convention deleted | −1 | −1 |
| new meta key | 0 (parts live on meta.actors; metaKeys stay 6) | +1 `meta.stages` (metaKeys 7) |
| stage parts | +3: `rules`, `task`, `inputs` (stages.js:12, all required at :79-83) | +3: rules (`meta.stages.X.task`, stage.js:58), input meanings (stage.js:59, :67), and the `task` invoke input. That input is still required, because the words for `task` are required and every name with words must be given (stage.js:68) |
| field attributes | +1 `covers` (stages.js:86, :101-115) | 0 (no attributes; the field-name convention of round 1 is gone) |
| load-time check | +1 `checkStages` | +1 `stageProblems` |
| coverage, reserved fields, stamped checkout/fetch | 0 (inside accept) | 0 (inside the restated check and accept) |
| **Total** | **25 primitives, 26 weighted** | **25 primitives, 26 weighted** |

Sensitivity:
- **M** is 24 weighted if the words map counts as one part and the task slot counts as plumbing. That is M's own
  lenient 23 plus the meta.stages key it left out. If the task slot does count, M's strict 25 agrees with mine at 26.
- **S** is 27 if "task names an input" counts as a second form of the task part.
- No reading that treats both lanes alike brings either one to 22. S's round-2 floor argument also holds for M: role
  −1, then at least +1 each for the load check, the rules, the task slot, the meanings and the coverage link.

## Critique fixes 1-14 (round 2)

C = fixed by construction, P = partly fixed, N = not fixed. A is unchanged from round 1.

| # | Fix | A | S (b1830bd) | M (1b9f083) |
|---|---|---|---|---|
| 1 | Brief instructions in JSON; refuse when missing | P | **C** quick-fix.json:201-211; required, stages.js:79-81 | **C** quick-fix.json:200-212; required, stage.js:58 |
| 2 | One result per Expect line; host checks coverage | N | **C** `covers` quick-fix.json:271; uncovered() stages.js:101-115; refused at actors.js:340 | **C** restates() actors.js:421-425, refused at :339; but see the new problems (a weak match, and no agreement check) |
| 3 | Data rule everywhere, covering handoff and files | P | **C** DATA_RULE stages.js:14, rendered first in every prompt at :57; the brief only fills Task (:51-53) | **C** DATA_RULE stage.js:8, rendered at :29 |
| 4 | Explain the retry inputs | N | **C** a meaning is required (stages.js:83); null is shown with its meaning (:54) | **C** required (stage.js:59, :67); rendered at :31 |
| 5 | Role line for every actor, with must-nots | P | **P** (was C) role is only the first rule by convention (quick-fix.json:203, :226) | **P** the same (quick-fix.json:216, :230) |
| 6 | Verifier: pinned commit, and what to do if it can't test | P | **P** host-made exact command as data (actors.js:363, quick-fix.json:264) plus fallback wording (:253, :257) | **P** host-stamped `fetch` refspec (actors.js:362) plus a command template and fallback in JSON (quick-fix.json:231, :233) |
| 7 | Return step impossible to miss | P | **C** returnLine stages.js:15, in every prompt (:61) | **C** returnPart stage.js:19, in every prompt and the SubagentStart context (actors.js:167) |
| 8 | Who names the branch | N | **P** JSON wording (quick-fix.json:207, :228) | **P** JSON wording (quick-fix.json:212, :217) |
| 9 | Verifier checks only the Expect lines; extras advisory | N | **C** extras refused (stages.js:109); advisory wording at quick-fix.json:254 | **C** extras refused (length check, actors.js:424) |
| 10 | Worktree facts | P | **C** (was P) runLine names the run, worktree, repo and branch in every prompt (stages.js:16, :61); the limit is in JSON (quick-fix.json:204 and in all 8 stages) | **C** a data-only Run part in every prompt (stage.js:26-27); the limit is in JSON for build and verify only (quick-fix.json:218, :231), and the P2 breach is fixed |
| 11 | Cut the noise | N | **C** (was P) stamped fields hidden (stages.js:30-32), $refs inlined (:36-45), the brief not repeated (:54) | **P** $refs inlined (stage.js:12-16), but target still shows key, fetch and green (stage.js:31 prints inputs whole); the schema is pretty-printed |
| 12 | Journal the send-back | N | **C** (was N) sentBack() actors.js:450 | **C** sentBack() actors.js:456, :484-486, :501-503 |
| 13 | Environment facts written once | N | **P** "paths from the repository root" (quick-fix.json:208) | **P** brief rules (quick-fix.json:205) |
| 14 | Optional `notes` on build | N | **C** quick-fix.json:246 | **N** |
| | **Total C / P / N** | 0 / 7 / 7 | **10 / 4 / 0** | **8 / 5 / 1** |

I mark S's fix 10 as C, while S claimed P, because runLine now names the repo. That puts S at 10 C, against its own
claim of 9.

## Applying the scoring rule

1. **Qualify** (12/12 scenarios, and weighted primitives at or below 22): only **A**. S has 26 and M has 26.
2. **For reference**, S against M by the tie-breakers:
   - Contract tests: 6 and 6, a tie.
   - Fixes by construction: S 10 against M 8, so **S ranks ahead**.
   - promptInEngine bytes would also favour S (8471 against 9021). Spec size (M 2834 against S 2856) would favour M,
     but it is never reached.
3. Composite score, used only to make the ranking numeric: (qualifies ? 100 : 0) + 10 × verified P tests + fixes by
   construction − promptInEngine ÷ 10000.
   - A: **98.92**
   - S: **69.15** (round 1: 67.16)
   - M: **67.10** (round 1: 57.05)

**Did the answer change? No.** Round 2 roughly halved the contract's cost: from +10 and +5 to +4 weighted in both
lanes. It also brought M's P2 to a pass, and S to 10 fixes by construction with no fix left undone. But the rule
qualifies only a lane at or below the control's 22 weighted, and both lanes sit at 26.

## New problems the contract causes (round 2)

Fixed since round 1, confirmed in code:
- Stage/workflow name collisions: both lanes now put stages after workflow names in handlers().
- M's pinned load breaking on a new workflow file: P1's round-2 case covers it.
- M's frame wording: moved to JSON.
- S's unjournalled send-back: now journalled.
- S's shown key/green: now hidden.
- The weaker checkout command: S restores the exact command as host data, and M as a stamped refspec.

Still present, or new:
- **M: PASS over a FAIL line now merges (confirmed by experiment).** In a temp test in the M checkout (removed
  afterwards), a verify result `{ result: "PASS", lines: [a PASS, b FAIL] }` was accepted, and the item reached
  `awaitingMerge`. Round 1's M refused this, and S still does (stages.js:111-112). The control had no lines, so this
  is no regression against A. But the contract's own lines are not used for the merge decision.
- **M: coverage matches by value, not by the `line` field (confirmed by experiment).** `restates()` accepts an entry
  if *any* of its values equals the expect line. `{ line: "something else", result: "PASS", evidence: "a works" }`
  counted as covering "a works", and the verdict was accepted. S checks `e.line` (stages.js:106).
- **M: coverage is optional by construction.** Remove `lines` from both the verify invoke and its words, and the
  coverage check disappears with no load error. S has the same shape if `covers` is removed. In both lanes, nothing
  requires a verify stage to declare coverage.
- **M: a pinned load still reads the current workflow folder.** If a child workflow file is deleted or renamed, an
  in-flight parent pinned to it now refuses to load, rather than failing at child start (M states this). This is
  milder than round 1's case.
- **M: target still shows host-stamped fields** (key, fetch, green). The JSON text says not to copy them, and the
  `reserved` refusal catches it if they are copied.
- **M: "task" still means two things**: the rules (`meta.stages.X.task`) and the task input.
- **S: the `task` part is overloaded.** It is either literal text or the name of an input (stages.js:51). A literal
  task that happens to equal an input name would silently become that input.
- **S: the checkout command is a template literal in engine code** (actors.js:363, +55 promptInEngine bytes). It is
  host-computed data, not prose, so I do not count it as a breach. It is the one place a shell command lives in the
  engine.
- **S: the worktree limit is still repeated in all 8 stages' rules**, a cost in spec weight.
- **Both: the role is no longer a required part.** Fix 5 drops to P, and a stage can omit its role line.
- **Both: pre-contract pinned workflows** still need a migration. S fails quietly (no handler takes their runs). M
  refuses at load.
- **Both: more actor names** (7 to 9: `researcher`, `write`). Research journals change actor names.

## Best ideas

- **S:** a model stage is just a `meta.actors` entry with `rules`, `task` and `inputs` beside its output schema. It
  needs no new meta key (metaKeys stay 6), and output, return and trust need no parts of their own.
- **S:** the renderer hides host-stamped ref fields from every input it shows (stages.js:30-32). The host's exact
  checkout command goes to the verifier as a declared data input, and copying any stamped field is refused as
  `reserved`. The verifier gets an exact command with no noise and no engine prose.
- **S:** `covers` on an output field, plus one generic check (stages.js:101-115), refuses missing, extra and repeated
  lines and a PASS that disagrees with its lines. The check matches on the `line` field and knows no workflow field
  names.
- **S:** at load, the invoke's input keys must exactly equal the declared inputs. Nothing reaches an agent without a
  meaning.
- **M:** the Run part as pure data label lines (run, item, stage, worktree, repo, branch). That keeps the frame to
  headings, the data rule and the return mechanics, while still giving every agent its worktree facts (fix 10).
- **M:** coverage by widening the control's existing `restated` rule, at zero new conventions. It is the leanest
  route to P5, though it needs S's per-`line` match and agreement check to be safe.
- **M:** state a limit only in the stages it applies to. The worktree limit sits in build and verify only, which
  avoids S's eight-fold repetition.
- **M:** a refused workflow is never stored as a blob, and an invoke src that is not a stage, an effect or a workflow
  refuses to load.
- **M (also adopted by S):** journal every send-back word for word with its hash. Also, put model stages after
  workflow names in handlers(), which fixes the collision at its root at no primitive cost.
- **A (control):** the baseline still wins on weight. 22 weighted is the bar both contract lanes now miss by 4.

## Bottom line

Round 2 shows the stage contract can be made lean: both lanes reach 26 weighted, and S's shape fixes 10 of 14
critique items by construction with none left undone. It is still not a simplification. It costs about +4 weighted
primitives, and both lanes argue that this is the floor. Under the rule set before the run, the answer stays no. If
the team wants the prompt fixes, take S's round-2 shape, together with M's data-only Run part and limits only where
they apply. Record it in `plan/decisions/` as a two-way-door decision that accepts about +4 weighted primitives,
not as a simplification.
