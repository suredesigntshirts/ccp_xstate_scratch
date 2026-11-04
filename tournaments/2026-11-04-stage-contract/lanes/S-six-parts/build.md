# Lane S (six parts): build

Tournament 2026-11-04-stage-contract. Copy: `/home/user/sc/S-six-parts`, branch
`tourney/2026-11-04-stage-contract/S-six-parts`, three local commits on base 23c3290 (not pushed):

- `a0c9462` Stage contract: meta.stages with six parts, one renderer, load and coverage checks
- `d23cec1` Contract tests P1-P6
- `601fadc` actors.js header comment describes the rendered prompt (comment only)

## Results (run, not reasoned)

| Check | Command | Result |
|---|---|---|
| Q1-Q9, F1, F2, R1 | `node --test packages/engine/test/tourney/*.test.js` | 23 scenario subtests pass, 0 fail |
| P1-P6 | same | 16 contract subtests pass, 0 fail (`# tests 39 # pass 39 # fail 0`) |
| npm test | `npm test` | `# tests 499 # pass 386 # fail 113`. The base (23c3290, and `/home/user/sc/A-control`) gives `# tests 487 # pass 375 # fail 112`. The 112 failures are the same tests, by name and location, before and after: they are pre-existing failures in lane A's base, in old `cases/`, `parity/` and `verify/` suites. The one extra failure is the timing test `plugins/harness/test/capture.test.mjs` "cheap: hook.run rows show at most 50 ms median...". It passed 3 out of 3 times when rerun alone, so it is load flakiness, not this change. |
| Mutation spot checks | temporary edits, reverted | Without the `checkStages` call, P1 fails 3 of 4. Without the `covers` refusal, P5 fails 2 of 2. Without `DATA_RULE` in the render, P3 fails. With one extra engine sentence in the render, P2 fails. With the brief also listed under Inputs, P4 and P6 fail. |

Measures, from `node scripts/tournament/measure.mjs --tournament tournaments/2026-11-04-stage-contract --lane <id> --checkout /home/user/sc/<id>` (run from `/home/user/ccp_xstate`, output to my scratchpad, not to the judge's `measure.json`):

| Measure | A-control | S (built) | Design predicted |
|---|---|---|---|
| suite | 27/27 | 39/39 | |
| promptInEngine.bytes | 10,787 (actors.js 4,100) | **8,386** (actors.js 1,041, stages.js 658) | about 8,390 |
| specLines qf / ft / rs = total | 1341 / 530 / 774 = 2645 | 1502 / 563 / 968 = **3033** | about 3000 |
| interpreterFilesChanged (spec.js, host.js) | [] | [] | [] |
| engineFilesChanged | [] | actors.js, index.js, stages.js | same |
| Weighted primitives | 22 (lane A round 2) | not recounted by me; the design's count stands at 32, or 33 weighted (section 11.1), and the build added no convention beyond the design | 33 |

Under the pre-written scoring rule, the build does not change the design's verdict. All 12 scenarios pass, but the weighted primitives (about 33 against 22) are above the control's. So lane S does not qualify as simpler. The judge does the primitive count.

## What changed (files)

- `packages/engine/src/stages.js` (new):
  - `PARTS`, `HEADINGS`, `DATA_RULE`, `returnLine` and `runLine` (the fixed frame).
  - `inline`, the `$ref` inliner.
  - `render()`, the only prompt assembler.
  - `checkStages()`, the load-time check.
  - `uncovered()`, the accept-time Expect-coverage check.
- `packages/engine/src/index.js`: `loadWorkflow` returns `checkStages(...)` on both the pinned path and the plain path (lines 30 and 41).
- `packages/engine/src/actors.js`:
  - Deleted: `AGENTS`, `contextOf`, `REF_RULES`, the old `DATA_RULE`, `SOURCE_RULE`, `roleOf`, `roleLines`, `writtenBrief` and `returnInstruction`.
  - `actors()` defaults `names` to `Object.keys(meta.stages)`.
  - `prepare()` refuses an actor that has no stage, stores `stage` in run.json, writes `render(run)` to brief.md and hashes it, and sets the context to `runLine`.
  - `accept()` refuses `covers` after `restated` and before refs.
  - Send-back uses `returnLine`.
  - `resultsOf` checks for `meta.stages`.
- `workflows/quick-fix.json`, `feature.json`, `research.json`:
  - `meta.stages` is added, verbatim from design section 7, except for the researcher key (see deviation 1).
  - The brief invoke's `task` literal is removed.
  - `verify` now has `lines` and no `report`, and quick-fix and research get a new `#line` definition.
  - quick-fix `build` gets an optional `notes`.
  - Research's `build` actor is split into `researcher` and `write`.
- Tests:
  - `test/tourney/world.js`: `verifies` returns `lines`.
  - `Q2`, `Q5`, `Q9` and `R1`: `report` becomes `lines`.
  - `prompts.test.js` is deleted.
  - `test/actors.test.js`: lines 97 and 124 (context regexes), and 163-165 (Task part, hash of the whole prompt).
  - New: `test/tourney/contract.js` (helper), `P1.test.js` to `P6.test.js`.

## Critique fixes 1-14, as built

| # | Fix | As built | Evidence |
|---|---|---|---|
| 1 | Brief instructions in JSON; refuse to run without them | **Fixed by construction** | `stages.js:59` (`lacks ${p}`), `:61` (role/return empty), `:71` (task invalid); `index.js:30,41` call it at load; brief task/role in `quick-fix.json:201-203`, `research.json:131+`, `feature.json:456+`; `writtenBrief` fallback gone; P1 tests every part of every stage |
| 2 | One result per expect line, host checks coverage | **Fixed by construction** | `quick-fix.json:328` and `research.json:272` `"covers": "issue.expect"`; `stages.js:94-108` `uncovered`; `actors.js:341` refuses `covers`; `report` removed (`quick-fix.json:337`, `research.json:288`); P5 |
| 3 | Data rule everywhere, incl. brief handoff and files | **Fixed by construction** | `stages.js:12` DATA_RULE (files, program output, outranks the task); `stages.js:34` rendered first under Limits for every stage; P3 |
| 4 | Explain retry inputs | **Fixed by construction** | `stages.js:66` (`input lacks meaning`), `:86` (`inputs differ`); meanings with null in `quick-fix.json:261-272`; P6 test 1 |
| 5 | Role line and must-nots for every actor | **Fixed by construction** | `stages.js:59,61,62` require role and non-empty limits; builder opens one PR `quick-fix.json:276`; verifier read-only `quick-fix.json:314` |
| 6 | Verifier: pinned commit meaning, what if it cannot test | **Partly fixed** | Construction forces `target`/`pr` meanings to exist; the "cannot test: FAIL with reason" wording is in `quick-fix.json:331` (return) and the `lines` meaning, which the contract requires to exist but not to be right. A mid-verify head move is not described to the agent. |
| 7 | Return step impossible to miss | **Fixed by construction** | `stages.js:13` returnLine ("Only that call counts: a text reply is not read"), always last (`stages.js:39`); send-back reuses it (`actors.js:467,480`) |
| 8 | Who names the branch | **Partly fixed** | `quick-fix.json:276` "Use no other branch name", `:226` brief told not to name one; the host does not check the PR's head branch |
| 9 | Verifier checks expect lines only; extras advisory | **Fixed by construction** | `stages.js:101-106`: lines must equal expect exactly and `result` must agree with them; `quick-fix.json:312` advisory limit |
| 10 | Worktree facts | **Partly fixed** | `stages.js:14` runLine (worktree, branch) in every prompt; confinement is each stage's first limit; checkout commands `quick-fix.json:311`; which repo it copies and where it starts are not stated |
| 11 | Cut the noise | **Partly fixed** (design said by construction) | Done: only the definitions the stage uses are printed inline (`stages.js:17-22,38`); the task input is not repeated (`stages.js:30`); the one-line context (`actors.js:167`); "Only the agent this run started may return" is gone (P2 test 3); PR rules appear only in `pr` output meanings. **Not done:** the report asks to hide host-stamped fields, but the verify prompt's `target` input still renders `"key":"o/r#1","green":true`. I saw this in a rendered `qf.verify` prompt. The renderer prints input values whole. |
| 12 | Journal every resume and send-back | **Not fixed** | Send-back text is `returnLine` (`actors.js:467,480`), still only in `sent-back.json` |
| 13 | Environment facts once | **Partly fixed** | Worktree, branch and return mechanics are in the frame once; "Use paths from the repository root" is in `quick-fix.json:227`; tool availability is not addressed |
| 14 | Optional `notes` on build | **Fixed by construction** | `quick-fix.json:336` schema, `:284` meaning; verify invoke inputs must equal its declaration (`stages.js:86`), and notes are not among them |

Totals as built: **by construction 8** (1, 2, 3, 4, 5, 7, 9, 14), **partly 5** (6, 8, 10, 11, 13), **not fixed 1** (12). The
design claimed 9 / 4 / 1. The difference is fix 11 (see the table).

## Deviations from the design

1. **Research's researcher `src` is `researcher`, not `research`.** This was a design bug. `effects/index.js` `handlers()` maps every workflow name (`quick-fix`, `feature`, `research`) to the child-item handler, and that mapping comes last, so it overrides actors. With `src: "research"`, each researcher invoke started a child *research item* instead of an agent run. R1 failed: the state went to `writing` instead of `researching`. Renaming the stage key, the `meta.actors` key and the three invokes to `researcher` fixed it. The design's "Tests are unaffected" holds after the rename. **New problem the contract exposes:** a stage name can silently collide with a workflow name, and `checkStages` does not refuse that.
2. **`checkStages` has three extra guards** that the design does not show: a stage that is not an object, `inputs` that are not an object, and `output` that is not an object. Each throws a short message instead of a TypeError. The messages stay under five words.
3. **`inline` is exported** from stages.js. Nothing imports it in the end (P2 uses its own inliner), so this is harmless. `render` passes `defs ?? {}`.
4. **actors.test.js lines 163-165.** These assert that `briefHash === sha256(prompt)` and that the Task part equals the builder brief, as the design says. That test (test 8) was already failing at base, at `d.state` (line 159), before it reaches these lines. It still fails there, unchanged. The design's edits are made but not exercised.
5. **P2's "measure.mjs promptInEngine" assertion** is done differently. The test does not import the tournament's measure.mjs, which lives outside the lane copy. Instead it searches all of `packages/engine/src/**/*.js` for 16 sentences of the control's deleted wording. I confirmed that all 16 occur in `/home/user/sc/A-control/packages/engine/src/actors.js`. It also asserts that the frame's only literals of five or more words are DATA_RULE and returnLine. The measure itself was run separately (8,386 bytes; stages.js 658).
6. **P4 also checks research's researcher, writer and verifier**, as the design's step 4 says. It checks the brief.stored hash for the verifier. The quick-fix brief prompt is not in P4, because its task is JSON text, not a brief.
7. **P5 research's accepted verdict cites `input.draft.sources`, not `[]`.** Research's `passed` guard needs `context.verdict.sources` to be present and non-empty, so an empty list goes to replanning. That guard is unchanged from the base.
8. **Header comment of actors.js updated** (commit 601fadc). The comment had said "the prompt the agent receives is the brief exactly", which is no longer true.

No other deviation. The stage JSON, the frame text, `render`, `uncovered`, the accept order (schema, reserved, restated, covers, refs), the send-back text and the test edits to Q2, Q5, Q9, R1 and world.js are as the design gives them. `spec.js` and `host.js` are untouched.
