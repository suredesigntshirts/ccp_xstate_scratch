# M-minimal: build report

Lane M, tournament 2026-11-04-stage-contract. Worktree `/home/user/sc/M-minimal`, branch
`tourney/2026-11-04-stage-contract/M-minimal`. The base is `23c3290`. Three local commits, none pushed:

- `656077b` Stage contract (lane M): meta.stages words map, one renderer, load check
- `a47a644` Stage contract (lane M): contract tests P1-P6
- `981fc10` Stage contract (lane M): send-back rule name, engine actors test context

## Results (all run in the worktree)

| Check | Command | Deciding output |
|---|---|---|
| Q1-Q9, F1, F2, R1 (23 tests) and P1-P6 (21 tests) | `node --test packages/engine/test/tourney/*.test.js` | `# tests 44`, `# pass 44`, `# fail 0` |
| Tournament suite and measure | `node scripts/tournament/measure.mjs --tournament tournaments/2026-11-04-stage-contract --lane M-minimal --checkout /home/user/sc/M-minimal --out <scratch>` (run from /home/user/ccp_xstate) | suite `exit 0, tests 44, pass 44, fail 0` |
| `npm test` | `npm test` | `# tests 504`, `# pass 392`, `# fail 112`. The base `23c3290` already gives `# tests 487`, `# pass 375`, `# fail 112`. The 112 failing test names are **identical** before and after (compared with `comm`). No failure is new, and the base's failures (in actors, cases, parity, verify/*, among others) were already in lane A as it was handed over. |

Mutation checks, run by hand and then reverted. Each one shows that a contract test catches a real break:
- Adding one English sentence to `render()` fails P2 and P4.
- Disabling the lines check in `accept()` fails P5.
- Disabling the load-time throw fails 11 of P1's 12 tests.
- Dropping the data rule from the frame fails P3.
- Dropping the input values fails P2 and P6.

## Measures (my run of the tournament's measure.mjs; the base was measured from a `git archive` of 23c3290)

| Measure | Base (control A) | M |
|---|---|---|
| promptInEngine.bytes | 10787 (76 literals; actors.js 4100) | **9508** (71 literals; actors.js 1466, stage.js 1355) |
| specLines total (feature / quick-fix / research) | 2645 (530 / 1341 / 774) | **2829** (544 / 1417 / 868), +184 |
| metaKeys distinct | 6 | 7 (+`stages`) |
| actors distinct | 7 | 9 (+`researcher`, +`write`) |
| interpreterFilesChanged | n/a | `[]` (spec.js and host.js untouched) |
| engineFilesChanged | n/a | actors.js, effects/index.js, index.js, stage.js |

## What changed (files)

- `packages/engine/src/stage.js` (new, 81 lines, no XState import):
  - `render()` (line 22) builds the whole prompt. Its parts are the Run line, the Rules (the frame sentence, the data rule, then the JSON rule lines), the Task, the Inputs (name, meaning, then the JSON value, null included), the Output (the schema with `$ref` resolved by `inline`) and the Return.
  - `returnPart()` (line 19) is the Return section.
  - `stageProblems()` (line 54) is the load-time check.
  - The fixed frame is the only English in the file: `DATA_RULE` (line 8), the Run line (line 27), the outrank sentence (line 29), the inputs and output sentences, and the Return paragraph.
- `packages/engine/src/index.js`: `checked()` (line 21) runs `stageProblems` with `EFFECTS` and the `*.json` names in `dir ?? REPO_WORKFLOWS`, and throws `workflow <name> refuses to load: ...`. It runs on the pinned path (line 44) and on the plain path (line 48), before the blob is stored. `render`, `returnPart` and `stageProblems` are exported (line 15).
- `packages/engine/src/effects/index.js:14`: `export const EFFECTS = ['merge', 'ask', 'post']`.
- `packages/engine/src/actors.js`:
  - Deleted: `AGENTS`, `contextOf`, `REF_RULES`, `roleOf`, `DATA_RULE`, `SOURCE_RULE`, `roleLines`, `writtenBrief`, the `effect.input.brief` branch and the `reserved` refusal.
  - Model stages are now `stagesOf(spec)` (line 23), used by `actors()` (line 108), `prepare()` (line 138) and `resultsOf()` (line 518).
  - `prepare()` renders the prompt after the run is built (line 165). `run.context` is `returnPart(run)` (line 167). `brief.stored.role` is `run.actor` (line 175).
  - `accept()` deletes `key`, `gates` and `green` from every ref in the stamped copy before any check (line 333). The restated check then compares fields, then lines against `issue.expect`, one for one and in order (line 345), then checks that `result` agrees with the lines (line 348). The ref checks run after that.
  - The send-back is journalled by `sentBack()` (line 456), called from `handback()` (line 486) and `stopped()` (line 503).
  - `returnInstruction` was reworded (line 438). See deviation 3.
- `workflows/quick-fix.json`:
  - `brief` is renamed `task` in the build and verify invokes (lines 24, 47 and 73), and the briefing task literal is shortened.
  - `meta.stages` (line 200) holds the brief, build and verify stages, word for word from the design.
  - `meta.actors.verify` now requires `lines` (lines 244-248), with descriptions.
  - `meta.schemas.ref` gains a description, and `grade` is added (line 255).
- `workflows/research.json`:
  - The task literal is shortened, and `brief` is renamed `task`.
  - The q1, q2 and q3 invokes now use `src: "researcher"`, and the write invoke uses `src: "write"`.
  - `meta.stages` (line 131) holds the brief, researcher, write and verify stages.
  - `meta.actors.researcher` and `meta.actors.write` replace `build` (lines 177-178). `verify` now requires `lines` (line 179).
  - `ref` gains a description, and `grade` is added (line 189).
- `workflows/feature.json`: `meta.stages.brief` (line 459). The invoke is unchanged.
- Tests:
  - New tests: `packages/engine/test/tourney/P1.test.js` through `P6.test.js`, plus the helper `contract.js`.
  - `world.js` gains `graded()`, and `verifies` returns `lines`.
  - Q2, Q5, Q9 and R1 change `report` to `lines` (10 results).
  - `prompts.test.js` is deleted.
  - `packages/engine/test/actors.test.js` has 2 assertions updated for the new context.

## The 14 critique fixes, as built

| # | Fix | Built | Evidence |
|---|---|---|---|
| 1 | Real brief instructions in JSON; refuse when missing | **fixed by construction** | The load check refuses a stage with no rules (stage.js:61), a stage invoke with no task (stage.js:72), or an invoke src that is not a stage (stage.js:76). These run on both load paths (index.js:44, index.js:48). The brief rules are in quick-fix.json:201, research.json:131-141 and feature.json:459. `writtenBrief` is gone, and P1 covers it. |
| 2 | Per-line verify results; host checks coverage | **fixed by construction** | The `grade` def is at quick-fix.json:255 and research.json:189. `lines` is required at quick-fix.json:244 and research.json:179. The host check is at actors.js:345 and actors.js:348. stage.js:65 refuses any issue-restating stage that does not require `lines`. P5 covers it. |
| 3 | Data rule everywhere, incl. brief handoff and checked-out files | **fixed by construction** | `DATA_RULE` (stage.js:8) names worktree files and program output. render puts it first in `# Rules` for every stage (stage.js:30). Brief output enters only as `# Task`, below the outrank sentence (stage.js:29). P3 and P4 cover it. |
| 4 | Explain retry inputs; give a rebuild what it needs | **fixed by construction** | Every input needs a meaning (stage.js:73-74). Nulls are printed with their meaning (stage.js:33). The build stage's `previous`, `verdict` and `failure` meanings are at quick-fix.json:224-226. P6 covers it. |
| 5 | Fixed role line and must-not list per actor | **fixed by construction (slot); wording by author** | The rules slot is required (stage.js:61) and always rendered (stage.js:30). The role and limit lines are at quick-fix.json:201-237, research.json:131-170 and feature.json:459. |
| 6 | Verifier: meaning of the pinned commit; what if it can't test | **partly fixed** | This is JSON wording only, at quick-fix.json:231 and quick-fix.json:233. accept() still checks HEAD and GitHub against `pr.at` (the ref checks in actors.js after line 349). Nothing forces another workflow to say it. |
| 7 | Return step impossible to miss | **fixed by construction** | `returnPart` always ends the prompt (stage.js:19, stage.js:35). It is also the SubagentStart context (actors.js:167). The send-back remains (actors.js:438). |
| 8 | Settle who names the branch | **partly fixed** | The frame states the worktree branch (stage.js:27). Workflow wording also covers it: build rules at quick-fix.json:217, and "do not name a branch" at quick-fix.json:204. |
| 9 | Verifier checks expect lines only; extras advisory | **fixed by construction** | The lines must equal `issue.expect` one for one (actors.js:345). An extra line is refused (P5 "a line not in expect is refused"). `result` must agree with the lines (actors.js:348). |
| 10 | State the worktree facts | **fixed by construction (host-known facts)**; how to reach the PR head is JSON wording | The Run line (stage.js:27) gives the worktree, which repo it is a worktree of, the branch, and the confinement. The checkout command is at quick-fix.json:231. |
| 11 | Cut the noise | **partly fixed** | Only the defs that are used are printed, and they are printed resolved (`inline`, stage.js:12; P2 and P4 compare the resolved schema). There is no "Only the agent this run started" line, and no repeated input or task. Not done: `target` still shows host-stamped `key` and `green` (explained by its meaning at quick-fix.json:238). The `ref` description also mentions PRs in research's source refs. |
| 12 | Record every resume and send-back message | **partly fixed** | The send-back text is journalled word for word as a `refusal` row with `rule: 'sent-back'`, `outcome: 'sent-back'`, `text` and `textHash` (actors.js:456-463). A resume by the session is not visible to the host and is not recorded. |
| 13 | Environment facts written once | **partly fixed** | The brief rules require paths from the repository root (quick-fix.json:205). There is no general environment-facts slot. |
| 14 | Optional `notes` on build result | **not fixed** | Left out by design. |

Tally: 8 fixed by construction (1, 2, 3, 4, 5, 7, 9, 10), 5 partly fixed (6, 8, 11, 12, 13) and 1 not fixed (14). This is the same as the design.

## Weighted primitives (what I built, for the judge to count)

The changes the design counted, as built:
- −1: the role convention (roleOf) is deleted.
- −1: the `brief` input is deleted.
- +1: `meta.stages`.
- −1: the `reserved` accept check is deleted.
- +1: the stage load check is added.
- spec.js and host.js are unchanged, so nothing counts double.
- Design net: −1.

Things the build adds that the judge may count:
- **Two actor names, `researcher` and `write`.** The measure's `distinct.actors` goes from 7 to 9. Actor names are not one of the first pack's kinds (the effect type is still `run`), but if the judge counts them as effect types, that is +2.
- **The `description` keyword in output schemas.** The design treats it as standard JSON Schema. Under this pack's rule, "each field attribute (meaning, trust, ...) counts as one spec convention", it could count +1.
- **The new load problem "stage named like a workflow"** is part of the same load-time check, so it counts 0.

Depending on how the judge counts, M lands between −1 and +2 against the control:
- The design's own count gives −1.
- If `description` counts as a field attribute: 0.
- If the actor names also count: +2.

## Deviations from the design

1. **Stage `research` renamed `researcher`; new load problem.** With the design's actor name `research`, the q1-q3 invokes started child items of the `research` *workflow*. The cause is that `handlers()` (effects/index.js) lets a workflow name override an agent handler. All three failed with "refused its input", and the R1 scenarios failed. I renamed the stage and actor to `researcher` (research.json:21, 33, 45, 142 and 177). I also added a problem to `stageProblems`: "stage X has the name of a workflow, which an invoke of X would start instead" (stage.js:60, with a P1 case), so a load-time check now catches the collision instead of it failing silently.
2. **Send-back journalled with `rule: 'sent-back'`, not `rule: 'no-return'`.** The verifier's own test `verify/engine-actor-returns/actor-returns.test.mjs:96` counts every `refusal` row with rule `no-return` as a failed run. The design's row made it fail. `outcome: 'sent-back'`, `text` and `textHash` are as designed.
3. **The send-back message is reworded** from "You are the invoked X actor for run R, and ..." to "This is run R (stage X), and ..." (actors.js:438). The design keeps `returnInstruction` as frame text, but its own P2 check forbids the phrase `You are the` in actors.js. The rest of the message is unchanged.
4. **Plain-path order.** The stage check runs before the blob is stored, so a refused workflow is never stored. P1 asserts this.
5. **`EFFECTS` is used only by the load check.** `byActor` in effects/index.js is unchanged. The design said both would use it, which is a cosmetic difference.
6. **Tests beyond the design's list.**
   - P1 adds four cases: an empty meaning, a missing output, a stage named like a workflow, and "not stored when refused".
   - P2 also asserts that no workflow rule line appears in any engine source file. It also bans the phrases `Your task:` and `Never set key, gates or green`.
   - P4 also checks that research's writer and researcher rules differ.
   - P5 adds four cases: a line not in `expect` is refused; a verdict with `report` and no `lines` gets a `schema` refusal; an all-PASS verdict reaches `awaitingMerge`; research verify is held to the same rule.
   - A shared helper `packages/engine/test/tourney/contract.js` holds the prompt collector, the frame allowlist and a test-local `$ref` resolver.
7. **Scenario test edits** match the design's list exactly: `world.js` gains `graded` and `verifies` returns `lines`; `report` becomes `lines` in Q2:40, Q5:21, Q9:29 and 37, and R1:51, 52, 79 and 102 (FAIL). Only the verify result shape changed. Every scenario assertion is unchanged, and `prompts.test.js` is deleted.
8. **Non-tourney tests.** Only `packages/engine/test/actors.test.js` was updated: two context assertions now expect the Return section that names the run. `plugins/harness/test/actors.test.mjs` and the parity and cases tests that the design said would need `lines` were **not** changed, because every one of them already fails at the base (112 failures in both, the same names). Whether those tests would also need `lines` once lane A's breakage is fixed is not established.

## Behaviour notes

- The build prompt's `pr` output carries "Your PR at the commit you pushed." in place of the `ref` description. That is because the sibling description overrides the def's description (the design's `inline` semantics). The HEAD rule for the builder comes only from its rule line at quick-fix.json:218.
- Design section 11 still applies: the verifier gets a generic checkout command, an agent that sets `key`, `gates` or `green` has them overwritten rather than refused, research journals name `researcher` and `write`, and workflows pinned before the contract refuse to load.
- Only scenario and contract tests were run. No real agent has been given one of these prompts.
