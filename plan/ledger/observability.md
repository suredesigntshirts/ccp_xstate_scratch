# Observability: ledgers, binding, freshness

### L-record-live-not-salvage
**Lesson:** Record events as they happen. Salvaging after the fact is slow, partial, and races an unknown retention window.
**Evidence:** Salvaging 10 sessions took about 320 `list_events` calls (one lead session: 119 calls, about 15 MB). Local transcripts die with the container, and the platform's retention is unknown. Copying the Library's harness folder takes about 26 minutes.
**Fate:** design. A mod or hook appends each tool call, completion and wake to the journal live.

### L-briefs-durable
**Lesson:** What a worker was asked (its brief) and what it returned must be stored durably and linked to its item.
**Evidence:** On 27 Oct, briefs existed only as Agent tool inputs in the session log, and outcomes files only in a scratchpad. The person confirmed: "no record of what the builder and verifier were given".
**Fate:** design. The host writes each brief and result to the item's folder and keeps its path in context.

### L-attribute-tokens-to-item
**Lesson:** Without a link from each call to its item and step, cost and time can't be explained per item.
**Evidence:** Spawns stopped binding when the bind hook timed out (ccp_machine#116). The session log has no item or state link (Harness on XState doc, "What Claude already records").
**Fate:** measure. Every journal row carries session, agent, item and state where known. A missing link is recorded as missing, never guessed.

### L-bind-by-guess
**Lesson:** Binding a subagent to its spawn by type and age needs serialization rules and races.
**Evidence:** `oneUnboundSpawn` and "spawn one at a time" (ccp_machine#57). Parallel same-type spawns mis-bound.
**Fate:** design. `$.agent.spawn` returns the agent id directly, so the host knows the binding at spawn time.

### L-version-every-session
**Lesson:** Log the running plugin and harness version per session, so a bug can be told apart from a stale install.
**Evidence:** A lead stamped harness 0.2.0 while main was 0.4.1, and an installed skill sat 29 commits behind (audit R6, F18). The person: "don't fix bugs that are already fixed."
**Fate:** measure. A fingerprint row at session start: Claude Code version, model served, plugin version and commit, allow-rule hash.

### L-copies-carry-lineage
**Lesson:** Every copy (installed plugin, settings, pages, reports) must say what it was built from and when, and something must notice when it falls behind.
**Evidence:** The Stop hook looked unregistered because settings merged only on container build. A README went false 7 minutes after it was written. Mission control said "updated 22:50" though it was republished about 02:20 (audit R6).
**Fate:** design. Pages and reports carry their source version and time, and the self-check compares the installed version with the latest.

### L-refusals-unmeasured
**Lesson:** Refusals (auto mode and hooks) cost the most time and were never counted, and denial records kept no command, so true and false catches couldn't be split.
**Evidence:** The pattern review couldn't split 73 text denials into real and false. `setsHarnessAgent` denials weren't recorded at all.
**Fate:** measure. Every refusal is a journal row with its source (classifier or hook), rule, a hash of the action, any retry and the outcome.

### L-checks-against-world
**Lesson:** Checks that compare the store with itself, on fresh state, miss what happened in the world.
**Evidence:** Doctor and replay passed while CI ids pointed at the wrong commits. A live budget snapshot lacked fields, so its guard could never fire (audit R5, F13: 7 PRs on one usage chain).
**Fate:** test. Health checks compare the journal with GitHub (PR heads, merges) and run against a copy of the live journal, not only fixtures.

### L-pages-current-on-demand
**Lesson:** Pages only need to be current while the person is looking. A button triggers an update, and each update records how long it took.
**Evidence:** The person's requirement, 27 Oct 18:12 (Issue 7). Static pages went stale for days.
**Fate:** design. Pages read the journal live through the artifact's files capability, and refresh time is recorded.

### L-rework-invisible
**Lesson:** Repeated rounds on one item weren't visible until someone counted by hand.
**Evidence:** FAIL rounds per item: gate-word-match 4, review-footer 2, history-tracer 2. #72's five rounds were noticed by the person.
**Fate:** measure. Rounds, red CI pushes and replans per item are counted, and a tripwire fires at the item's `step_back` limit.

### L-harness-overhead
**Lesson:** Much of v1's effort went into the harness's own bookkeeping (eras, joins, replay, binding) rather than product work.
**Evidence:** About 70 ccp_machine commits on 28-29 Oct, most of them on history, replay, eras, binding and pages.
**Fate:** measure. Report tokens and time spent on harness work against product work, per day.

### L-usage-windows
**Lesson:** The 5-hour and 7-day usage windows are the budget's real inputs, readable from `rate_limit_event` in session logs or `$.session.usage()` in a mod.
**Evidence:** The 26 Oct design: default budget 10% of the 7-day window per day, soft limit to start wrapping up.
**Fate:** measure. Usage readings go into the journal at each turn's end.

### L-person-interactions-logged
**Lesson:** Every message and tap from the person is recorded. Reactions before the log began were lost.
**Evidence:** The person's ask, 27 Oct 02:12. Kept in v1 at Library: harness/ledger/person/interactions.jsonl.
**Fate:** measure.

### L-pages-round-budget
**Lesson:** Page work expands without bound: PR #110, built to prove the XState skeleton, spent 17 of its 23 commits on inspector polish rounds and review-lens agents, and was never merged.
**Evidence:** git log of ccp_machine branch claude/project-thread-3kdqwr (plan-review finding 10).
**Fate:** design. Pages come after a real item, carry a round budget, and get polish rounds only when the person asks.
