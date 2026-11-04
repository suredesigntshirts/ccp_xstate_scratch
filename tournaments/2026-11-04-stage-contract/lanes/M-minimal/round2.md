# M-minimal, round 2

Lane M, tournament 2026-11-04-stage-contract. Worktree `/home/user/sc/M-minimal`, one new local commit on top of
round 1, not pushed:

- `1b9f083` Stage contract (lane M, round 2): frame only in engine, coverage by restatement, no folder collision

## Result first

- I could not get M to 22 weighted primitives or below on the judge's count. I did not find an honest way to do it.
- On the judge's strict count M goes from 26 primitives (27 weighted) to **24 (25 weighted)**. On the judge's most
  lenient consistent reading it goes from 23 (24 weighted) to **22 (23 weighted)**. Under the rule written before the
  run, M still does not qualify.
- The two removals that were within reach are both made: the `issue`/`lines`/`expect` field-name rule is gone, and
  the `task` input is no longer a separate requirement.
- What is left is the floor of any stage contract in this engine:
  - the control's 21 primitives,
  - minus the role convention (−1),
  - plus a key that holds the stage words (+1),
  - plus at least one part (+1, or +2 when rules and meaning count apart),
  - plus a load-time check, which P1 requires (+1).
  
  That is at least 22 primitives (23 weighted), and 23 (24 weighted) when rules and meaning count as two parts.
- To get lower, I would have to hide the words map inside `meta.actors` under a made-up keyword, or call the new load
  check a rule of the pin. The judge's own rules count both of those (see "What I did not do"). So the answer to the
  pack's question stays **no**: even at its leanest, the contract adds weight.
- All 12 scenario tests and all six contract tests pass: `node --test packages/engine/test/tourney/*.test.js` gives
  `# tests 47`, `# pass 47`, `# fail 0`.
- P2 now asserts the pack's rule itself, not a widened allowlist.

## What I removed or grafted, and why

| Change | Why | Where |
|---|---|---|
| **Removed the field-name convention.** accept() no longer knows `issue`, `lines` or `expect`, and the load check no longer says "an output with issue must require lines". | Of the judge's +1 items, this was the only one that is pure engine coupling. | stage.js has no such rule. actors.js:335-340 |
| **Coverage now comes from the existing restated rule.** A result field named like an input restates that input. That was the control's rule, and it is now extended: a list of strings is restated by one object per string, in the same order, each object holding its string. The verify invokes now give `lines: "context.issue.expect"`, with a meaning. | A new rule inside the existing accept() check costs 0 (the judge's rule). No field name appears in the engine, so the JSON decides which field is covered: it lives in the invoke input and the output schema, as with lane S's `covers`, but with no new attribute. | `restates()` actors.js:421-425. Its call is at actors.js:338. Inputs at quick-fix.json:47 and :73, and research.json:71. Meanings at quick-fix.json:238 and research.json:168 |
| **Removed the separate "required task input" rule.** The load check now has one symmetric rule: every input an invoke gives has words in `meta.stages.<s>`, and every name with words is given. Lane S's graft makes the two key sets equal. A stage's rules are the words for `task`, so the rules part requiring words implies a task input. That is not a rule of its own. | This was the judge's third M part. The `task` input name is the control's own input. The judge counted the control's `brief`/`task` inputs as 0. | stage.js:66-68 |
| **Removed the collision rule** ("stage X has the name of a workflow"). **Fixed the cause**: in `handlers()`, a workflow's own stages now come after the workflow names, so a stage is never shadowed by a workflow file. | The judge confirmed this bug: adding `write.json` made a pinned research item refuse to load (it broke Q8's property). The pinned load no longer depends on which workflow files exist beside it. | effects/index.js:31-35. Tests: P1 "(round 2)", two cases |
| **The frame is now only what the pack allows.** Removed from stage.js: the hard-coded worktree limit, the "These rules are fixed…" sentence, and the Inputs and Output explanatory sentences. The outrank statement is now part of the data rule. The Run part is data only (`run:`, `item:`, `stage:`, `worktree:`, `repo:`, `branch:`). The schema reference moves into the return mechanics. The worktree limit is now JSON, in the build and verify rules. | The judge rejected P2 because of these sentences. | stage.js:8 (DATA_RULE), :19 (returnPart), :22-35 (render). quick-fix.json:218 and :231 |
| **P2 now asserts the pack's rule.** The allowlist is only the headings, DATA_RULE, the return paragraph and the data-only Run part. A new third P2 test reads stage.js. Every string or template literal of five or more words in it must be DATA_RULE, the return paragraph, or a load-problem message (an author error, never shown to an agent). | The judge's rejection | contract.js `FRAME`. P2.test.js, third test |
| **Restored the `reserved` refusal.** An agent that sets `key`, `fetch`, `gates` or `green` is refused, as in the control. | The judge noted that these fields were dropped silently. The refusal is a rule of the control's own accept check, so it costs 0. | actors.js:330-334. Test: P5 "(round 2)" |
| **Graft (lane A): the checkout comes back as host data.** accept() stamps `fetch: "pull/<n>/head"` on every PR ref, next to `key`. The verify rules now say `git fetch origin <target.fetch> && git checkout --detach <target.at>`, both values copied from target. | The judge found the computed command lost in both contract lanes. It returns as host-filled data with no wording in the engine, through a stamped field: a rule of the existing check, cost 0. | actors.js:362 and :417. quick-fix.json:231 and :239. P5 "(round 2)" asserts `target.fetch === 'pull/1/head'` |
| **Graft (lane S): the P4 hash link.** The builder and verifier briefs fixed at the brief accept (`brief.stored` rows) hash to sha256 of the build and verify runs' Task parts, in quick-fix and research. | Proves that the brief is the task part byte for byte. Test only. | P4.test.js |
| **Kept from round 1:** the journalled send-back (fix 12), "a refused workflow is never stored", "an invoke src that is not a stage, an effect or a workflow refuses to load", and no trust attribute. | The judge listed all four as worth keeping. | actors.js:456-463, :486, :503. index.js:47-51. stage.js:69-70 |

What I dropped with the field-name rule: **the host no longer refuses a verdict whose `result` disagrees with its
lines** (PASS over a FAIL line). Checking that would need the engine to know `result` and `PASS`, which is the same
coupling the judge counted. The schema description now asks for it (quick-fix.json:246), but nothing enforces it. The
control had no lines at all, so this is not lost behaviour of lane A. It is a round-1 check that round 2 gives up. P5's
"disagreeing" case is removed.

## Count before and after, on the judge's list

The judge's rules: credit only for removing something in the control's 21; a new rule inside the existing accept()
check costs 0; a new load-time check costs +1; engine plumbing (renderer, "agent iff stage", EFFECTS) costs 0; each
stage part and field attribute counts +1.

| Item | Judge, round 1 | Round 2 (strict) | Round 2 (lenient) |
|---|---|---|---|
| Control | 21 | 21 | 21 |
| role-from-schema convention deleted | −1 | −1 | −1 |
| `meta.stages` key | +1 | +1 | +1 |
| Part: rules (`meta.stages.X.task`) | +1 | +1 | +1 (one words map) |
| Part: meaning per input | +1 | +1 | (same map) |
| Part: required `task` input | +1 | 0 (no rule of its own, see above; +1 if the judge still counts the slot) | 0 |
| Field-name convention (`issue` → `lines`) | +1 | **0** (gone; coverage is a rule of the existing restated check) | 0 |
| Load-time check (`stageProblems`) | +1 | +1 | +1 |
| `fetch` stamped, `reserved` restored, generic restatement | n/a | 0 (rules inside the existing accept check) | 0 |
| **Primitives** | **26** | **24** (25 if the task slot counts) | **22** |
| **Weighted** (the invoke list form counts double, as in the control) | **27** | **25** (26) | **23** |

measure.mjs agrees that nothing new appears in the counted kinds: `interpreterFilesChanged: []` (spec.js and host.js
are untouched), guard forms {present, in, same}, op {set}, effects {run, stop}, and metaKeys 7 (the 6 of the control
plus `stages`).

## What I did not do, and why

- **Moving the words map into `meta.actors.<s>`** under a new keyword would remove the "new meta key", but only by
  hiding a stage convention inside a schema. That is the same convention under another name, and the judge counts
  conventions, not keys.
- **Calling the stage check a rule of the pin** (the control's load-time check) would make it 0. But the judge's rule
  says plainly that a new load-time check in loadWorkflow costs +1.
- **Rules as the output schema's optional `description`.** The judge counts an optional, unchecked `description` as 0.
  But P3 needs limits in every prompt, and unchecked limits would let a stage ship with none.
- **No control primitive can be removed honestly.** I checked meta.input, meta.events, the guard forms, the invoke list
  form, run/stop and child items: every one is used by a scenario test or by a behaviour the pack keeps.

## Critique fixes (kept, lost, gained), with file:line at 1b9f083

| # | Round 1 (judge) | Round 2 | Evidence |
|---|---|---|---|
| 1 Brief instructions in JSON; refuse when missing | C | **C (kept)** | The brief rules are at quick-fix.json:202, research.json:133 and feature.json:460. stage.js:58 refuses missing rules, and stage.js:64-70 refuses any input without words. P1 |
| 2 Per-line verify results; host checks coverage | C | **C (kept, now generic)** | The restated check covers lines at actors.js:338 and :421-425. `lines` is in the inputs (quick-fix.json:47, :73; research.json:71) and is required in the output (quick-fix.json:245, research.json:180). P5 |
| 3 Data rule everywhere, incl. the brief handoff and files | C | **C (kept)** | DATA_RULE (stage.js:8) heads `# Rules` in every prompt (stage.js:29). The brief is only `# Task`. P3, P4 |
| 4 Explain retry inputs | C | **C (kept)** | Symmetric words (stage.js:66-68). Null rendered with its meaning (stage.js:32). quick-fix.json:224-226. P6 |
| 5 Role line and must-nots per actor | P | **P (unchanged)** | The rules are required (stage.js:58), but no separate role part is required. The role is the first rule line by convention (quick-fix.json:203, :216, :230) |
| 6 Verifier: the pinned commit, and what to do if it cannot test | P | **P, stronger** | The exact refspec is host data again (actors.js:362). The command and the fallback are at quick-fix.json:231 and :233. Still wording that a workflow need not state |
| 7 Return step impossible to miss | C | **C (kept)** | returnPart ends every prompt (stage.js:19, :33) and is the SubagentStart context (actors.js:167) |
| 8 Who names the branch | P | **P (unchanged)** | quick-fix.json:204 ("do not name a branch") and :217. The Run part names the branch as data (stage.js:27) |
| 9 Verifier checks only the expect lines; extras advisory | C | **C (kept)** | An extra or reordered line is refused (actors.js:421-425). Advisory wording at quick-fix.json:233. P5 "extra" case |
| 10 Worktree facts | C (via the frame sentence, the P2 breach) | **C (kept, now within the pack)** | The data-only Run part names the worktree, repo and branch (stage.js:26-27). The limit is JSON (quick-fix.json:218, :231) |
| 11 Cut the noise | P | **P (slightly better)** | The frame lost three explanatory sentences. The verify prompt still shows target's stamped `key`, `fetch` and `green`, now explained and forbidden to copy (quick-fix.json:239), and `lines` repeats issue.expect |
| 12 Journal every send-back message | C | **C (kept)** | actors.js:456-463, :486 and :503 |
| 13 Environment facts written once | P | **P (unchanged)** | "paths from the repository root" at quick-fix.json:205 |
| 14 Optional `notes` on the build result | N | **N (unchanged)** | Not added |
| **Total C / P / N** | **8 / 5 / 1** | **8 / 5 / 1** | Fix 6 moves within P, toward C. Nothing is lost at the fix level. The PASS/lines agreement check is the one mechanism lost (see above) |

## Measures (measure.mjs at 1b9f083)

| Measure | Control A | M round 1 | M round 2 |
|---|---|---|---|
| Tourney suite | 27/27 | 44/44 | **47/47** (exit 0) |
| promptInEngine.bytes | 10787 | 9508 | **9021** (stage.js 1355 → 879) |
| specLines total | 2645 | 2829 | 2834 (feature 544, quick-fix 1420, research 870) |
| distinct actors / metaKeys | 7 / 6 | 9 / 7 | 9 / 7 |
| spec.js / host.js changed | no | no | no |

## Judge's new problems for M: status

- **The pinned load read the workflow folder (collision):** fixed. There is no collision rule, and stages win in
  `handlers()`. The pinned load still reads the folder for one thing: to know which srcs are child workflows. Starting
  a child does the same. A new file never refuses a pinned load; a deleted child workflow file now refuses it at load
  instead of at child start (P1 round-2 tests).
- **`task` means both the rules and the task input:** kept by design, with symmetric names. Every key in a stage's
  words map is an input name, and the words for `task` are the rules that govern the task. An input can be named
  `task`: it is the task. I did not split it into `{ rules, inputs }`. The split would be clearer to read, but it
  would turn the one words map, which the judge's lenient reading counts as one part, into two explicit parts.
- **accept() was hard-coded to issue/lines/expect:** fixed (generic restatement).
- **key/green were stripped silently:** fixed. They are refused as `reserved` again, together with `fetch`.
- **The generic checkout wording replaced the computed command:** fixed. The refspec is host data (`target.fetch`).
- **Older pinned workflows no longer load:** not fixed. A blob from before the contract still refuses to load
  (`build is not a stage, a host effect or a workflow`). Items in flight need a migration.
