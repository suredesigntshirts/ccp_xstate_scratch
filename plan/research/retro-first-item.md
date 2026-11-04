# Retro: the first real item

**Date:** 2026-10-31
**Item:** first-real-issue, first run (engine item `fri-jsonl-lint`): ccp_machine_test#102, a `jsonl-lint` tool, to
PR #103. The product repo and issue were the stand-in's pick (`plan/decisions/2026-10-31-first-real-issue-product-repo.md`).
**Evidence:** the item's journal (`/mnt/project-files/first-real-issue/harness/journal`, item file
`items/fri-jsonl-lint.jsonl`, one session file for driver session `b61aac02-…`), `derive.js time` over it, its
verifier's evidence (commit f799583, kept in history; patches in `/mnt/project-files/first-real-issue/parked-pr/`),
and GitHub.

## What ran

The thread filed the issue (02:43Z), then a headless driver session on the engine filed the item and started three
Sonnet agents, one per actor run, each finished through the harness return hook:

| Run | Agent | Time | What it did |
|---|---|---|---|
| brief | a2ebf056… | 28.2 s | builder and verifier briefs from the issue |
| build | a996384a… | 79.2 s | branch `feat/102-jsonl-lint`, 8 files, PR #103 at 6823559, waited for CI |
| verify | a3ecae1c… | 46.3 s | fresh checkout, `npm ci && npm test` 12/12, CLI runs, two mutations; PASS at 6823559 |

The item reached `awaitingMerge` at 02:47:42Z, 3 min 18 s after the driver started. Four transitions, each with its
source: the filing session's start, then three return-hook completions. The ask card went up in the thread at
02:47:53Z. The person was away; at 03:04Z the stand-in merged #103 at the verified sha outside the host (merge
b74bddb3), so the item's journal stops at `awaitingMerge`.

## The numbers

All from the journal; times from `node packages/journal/bin/derive.js time` and the `agent.finish` / `turn.usage`
rows.

**Tokens** (input + output + cache read + cache creation):

| Session | Input | Output | Cache read | Cache creation | Total |
|---|---|---|---|---|---|
| driver (`turn.usage`) | 19 | 2,018 | 312,953 | 30,948 | 345,938 |
| brief agent (last `agent.finish`) | 10 | 3,104 | 73,720 | 27,450 | 104,284 |
| build agent | 18 | 5,464 | 210,944 | 22,046 | 238,472 |
| verify agent | 10 | 3,692 | 119,018 | 22,445 | 145,165 |
| **item** | **57** | **14,278** | **716,635** | **102,889** | **833,859** |

The brief agent has two `agent.finish` rows (02:45:12Z and 02:45:17Z, cumulative). Summing both would overstate the
item by 76,459 tokens (9%). The table takes the last row per agent. The owning thread's own tokens (filing, card,
merge, verifier subagents) are not in the item's journal and are not counted.

**Time by kind** (driver session, `derive.js time`): wall 198.5 s; working 196.2 s; waiting on a wake 0.6 s, on the
session's start 1.5 s, unknown 0.2 s; waiting on the person 0 s; waiting on CI 0 s. Agent time inside the working
span: 153.7 s (brief 28.2, build 79.2, verify 46.3). The wait on the person, 16 min from card (02:47:53Z) to the
stand-in's merge (03:04Z), happened in the thread's session, so the item's view shows 0.

**Rounds:** 1 build, 1 verify, 0 rework. The product's `test` workflow ran once on the PR head, green, and once on
the merge commit, green.

**Refusals:** 0 in the item's sessions (no refusal rows; the builder's push and REST PR to ccp_machine_test went
through). In the owning thread, 2: `gh api` filing the issue in ccp_machine_test was refused [External System
Writes] (02:43Z; the GitHub MCP issue tool then filed it), and a force-push of the thread's own branch was refused
[Git Destructive] (03:09Z; a forward commit replaced it). Neither is in the item's journal: the thread's session
isn't journalled into the item.

**Person asks:** 1, the merge card the workflow declares. 0 answered by the person; the stand-in closed it.

**Completeness:** 28 tool calls in the driver's and agents' event logs, 27 `tool.call` rows; the one without a row
(`sleep 60; gh pr checks`) was blocked by Claude Code before it ran, so no hook saw it.

## Findings

1. **An ask with nobody to answer it stops the item** (L-standin-gap). The person was away, as they usually are; the
   workflow's one ask had no answer the host would accept, so the merge happened outside the host and `merged` was
   NOT MET. 3 minutes of machine work then waited 16 minutes on a person who said they wouldn't come. This is
   L-stand-in-decides and L-never-idle-on-person seen in v2. It makes engine-cards-standin the next build, ahead of
   everything else in s4b (moved into s4 by replan PR #47).
2. **Per-item views miss what happens outside the item's sessions** (L-item-view-spans-sessions). The person wait,
   the card and both refusals happened in the thread that owns the item, and the derived time view shows 0 s on the
   person. Cost and waits per item need the thread's rows joined to the item. This justifies engine-item-views.
3. **One agent, two finish rows** (L-agent-finish-twice). The brief agent's SubagentStop fired twice with cumulative
   tokens. A per-item token view that sums rows overcounts (here by 9%); it must take the last row per agent. A test
   in engine-item-views.
4. **The real run needed a copy of the toy script** (L-real-run-reuses-toy). `scripts/toy-run.sh run` writes its own
   toy issue, so the real run used an out-of-repo copy that takes an existing issue and its Expect lines. The rerun
   after engine-cards-standin should not need a hand copy; engine-cards-standin's rerun path takes an issue URL.
5. **Allow rules are per repo, and tools differ** (L-allow-rules-per-repo). No allow rule names ccp_machine_test, so
   the thread's `gh api` write there was refused while the GitHub MCP tool and the headless builder's push were not.
   A product repo needs its own rule before a stand-in works there unattended; that is a settings change, so it goes
   on the person's list.
6. **The workflow itself was enough.** quick-fix ran a real product issue unchanged: no state, guard or brief needed
   editing, the builder followed the product repo's own CLAUDE.md (branch naming, Closes line), and the verifier ran
   mutations unprompted. Nothing in this run asked for a new workflow, schema change or fragment.

## What this does to the plan

- **engine-cards-standin**: next, now in s4 (finding 1). first-real-issue reruns after it.
- **engine-item-views**: kept in s4b, after engine-cards-standin (findings 2 and 3).
- **wf-schema, wf-fragments, wf-catalogue**: parked (finding 6). No finding from this item needs them; they come
  back when a real item needs a workflow quick-fix can't run.
- New ledger rows for findings 1 to 5 in `plan/ledger/process.md` and `plan/ledger/observability.md`; finding 6 is
  evidence on L-build-for-next-real-item.
- The allow rule for ccp_machine_test goes in `plan/decisions/waiting-for-person.md`.
