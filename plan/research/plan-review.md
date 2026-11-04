# Independent review of plan/ (ccp_xstate, branch docs/v2-plan), 2026-10-30

Read: README, item.schema.json, check.mjs (and ran it, plus mutation tests on a copy), all 7 stages, 34 items,
6 ledger files (70 rows), cases, research/workflows.md. Primary evidence: silo memory (MEMORY.md,
xstate-orchestrator-skeleton, xstate-rework-review-verdict, xstate-remodel-direction, mod-probe-classifier-block,
harness-reset), the root-cause audit, the pattern review, and PR #110 (origin/claude/project-thread-3kdqwr).

Most severe first.

1. **High. The walking skeleton comes 27 items in, after a wide observability stage. This repeats v1's drift
   instead of preventing it.**
   Evidence: `node plan/check.mjs --order` puts first-real-issue after 26 items (s0 has 9, s1 7, s2 4, s3 7).
   Those items add 28 of the plan's 29 concepts. 17 of the 28 are bootstrap or observation (journal row, kind,
   upcaster, setup script, install marker, fingerprint, self-check, release, capture, blob, journal check,
   attention view, refusal row, derived view, tripwire, observe page, ...), counted from each head's
   `concepts.adds`. engine-toy-run waits on obs-page through engine-item-views, and engine-host waits on
   wf-catalogue (four workflows). The 06:19 review verdict in memory (xstate-rework-review-verdict) named the
   constraint as "one real issue end to end in a real Projects thread". It said PR #110 already covers steps
   1-2: XState drives an item end to end with actors, replay and stale-run refusal, in about 650 lines on
   xstate 5.33.3. The plan cites #110 only as "prior art" (engine-host inputs) and re-derives it behind a
   schema, a compiler, fragments and a catalogue.
   Change: add a thin path, about 7 items, before widening.
   (a) The expanded probe-platform-baseline (see 3).
   (b) repo-skeleton.
   (c) setup-script, plugin-install and session-fingerprint-selfcheck merged into one item, with only the
       fingerprint row and a short self-check.
   (d) journal-schema without the upcaster. Keep `v` on every row and add upcasting with the first version bump.
   (e) obs-live-capture merged with obs-briefs-and-results.
   (f) A new "port-110-skeleton" item: #110's item.machine.json as the single quick-fix workflow, the mod host,
       real builder and verifier actors, and a merge effect.
   (g) first-real-issue.
   After that, the retro decides the order of the rest: obs-page, the derived views, journal-vs-world,
   self-update, clean-room, wf-schema/fragments/catalogue, and cards/stand-in. Each one then serves a measured
   need, not a guess.

2. **High. The first "real" issue is harness work, so the plan's own overhead metric would score v2's first
   success as 100% overhead.**
   Evidence: first-real-issue takes "A real issue in ccp_xstate". obs-time-and-rework's `overhead` line counts
   "this repo's plugins/ and packages/ as harness; other repos as product". L-harness-overhead is the drift
   lesson. The person's stated v1 failure is the harness building tools to observe itself.
   Change: make first-real-issue (and the toy run's scratch repo) target a product repo, such as a
   ccp_machine_test tool or another repo the person names. Add a ledger row: "the first real item is product
   work".

3. **High. Riskiest unknowns with no probe.**
   (a) Self-modification. Every s0-s3 item edits `plugins/harness` in the same repo the setup script installs
       into every v2 session (setup-script outputs). That is v1's [Self-Modification] situation (L-no-self-modification).
       The ledger's own fate, "the repo that builds v2 is never the plugin the building session loads", is
       broken by the plan as written. No probe tests a thread editing and committing plugins/harness while the
       released plugin is loaded.
   (b) Host merge on an idle wake. The probe tests spawn only (idle-spawn), but merge is the effect most
       likely to be refused (L-merge-without-review-flag: after that flag even read-only calls were denied).
   (c) Artifact pages reading the Library journal live. L-pages-current-on-demand and obs-page assume an
       "artifact files capability" that reads the journal. Nothing checks that a page can read /mnt/project-files.
   (d) $.agent.spawn ignores cwd (CC 2.1.312, per xstate-orchestrator-skeleton memory), so builder worktree
       isolation is unproven (L-scratch-names-carry-item).
   (e) xstate: probe-xstate-runtime sits in s3 behind wf-fragments, yet v5 restore and stale refusal are
       already shown in #110.
   Change: add (a)-(d) as Expect lines of probe-platform-baseline. Pin xstate 5.33.3 now and park the v6 probe
   as a spike. That also removes wf-schema's `both-xstate` line.

4. **High. Multiple hosts and cross-session journal lag are not designed for.**
   The plugin loads in every thread of the project, and wakes arrive per thread. journal-schema writes one
   file per session, and `read(root)` merges every file by time. L-library-mount-slow says other sessions see
   writes about 40 s late. An item restored from that merge in thread B can be 40 s stale, which gives double
   effects that C-duplicate-wake-no-double-effect (same event, one host) does not cover. `read(root)` also
   lists the folder on the hot path, which the ledger forbids ("hooks never scan folders"; the #116 timeout).
   Change: add a case, C-two-hosts-one-item. Give each item one owner (one thread, recorded at filing) and one
   journal file, as #110 did with journal.jsonl per item. engine-host should say where the owner is recorded
   and how a second host refuses.

5. **High. Expect lines that can't be checked before accept, or not by a separate verifier.**
   - obs-live-capture `complete`: it uses obs-journal-vs-world's compare script, but that item depends on
     obs-live-capture.
   - self-update-by-version `next-session`: needs a merge, a release and a new session. The verifier brief
     admits this ("If a real release exists").
   - clean-room-install-test `green`: the job runs "on release and on demand", not on the PR.
   - wf-schema `both-xstate`: reads "the 6 alpha the probe pinned", but the probe comes later
     (probe-xstate-runtime depends on wf-fragments, which depends on wf-schema).
   - probe-platform-baseline `idle-spawn` and `rerunnable`: a verifier subagent can't produce a fresh wake
     with no person message, so "one command" can't cover the wake rows.
   - engine-cards-standin's verifier brief: "post one real card ... and answer it" needs a person's tap.
   - obs-page `refresh` and `lineage`: "Click once" or "Read the page" need a published page and a click. A
     subagent can do neither.
   Change: move these to `after_landing` or to the stage gate, or replace them with fixture tests. Make the
   checker refuse an Expect `how` that names an output of a non-upstream item (see 9).

6. **Medium. obs-refusal-log contradicts L-retries-look-like-bypass.**
   `retry-linked` asks for a deliberately refused action to be retried once in a live session. The ledger says
   retries read as bypass, and after a flag even read-only calls are denied. Classifier refusals are also not
   deterministic, so a verifier can't reproduce them reliably.
   Change: test retry linking on recorded refusal fixtures from the probe. A live refusal happens once, in the
   probe only.

7. **Medium. The person's attention is spent before any value arrives.**
   About 16 `person_prereqs` fall before first-real-issue: project creation, allow rules plus rebuild (several
   times, in probe, obs-live-capture, engine-host, engine-actors and engine-effects), a push to main, pasting the
   stub, the install conversation, a CI API key, the page read, a grants.json conversation, a scratch repo, and
   the three-question decision. That conflicts with L-attention-is-the-constraint.
   Change: the probe outputs the complete v2 allow-rule set. The person places it in one sitting with one
   rebuild. Fold wf-choose-first into that sitting: it needs only research/workflows.md, not wf-catalogue.

8. **Medium. Over-built workflow stage.**
   wf-catalogue builds four workflows and wf-fragments four fragments, including the optional
   C-pass-carries-to-merge-of-main, before anything runs. Yet wf-catalogue claims L-build-for-next-real-item,
   and research/workflows.md says "the walking skeleton needs only one". wf-schema's "compiler has no named
   guard functions" forbids the named-guard approach #110 proved.
   Change: write one workflow (quick-fix, as #110's JSON) now. Add the schema, compiler and fragments when
   second-workflow needs them. Let the builder choose the guard representation.

9. **Medium. Checker flaws (confirmed on a copy).**
   - The `--coverage` drop regex `^### (L-…)\n[\s\S]*?\*\*Fate:\*\* drop` matches lazily across rows. A drop
     row exempts the first row in its file and is itself reported as unserved. Tested: it returned
     `[L-rules-in-spec-not-host]` for a drop row appended to growth.md. Fix: split the file on `^### ` first.
   - Dropped, split and parked items still count as serving ledger rows.
   - A live item may depend on a dropped item. Tested: second-workflow set to dropped, and the plan still
     passed.
   - "dropped needs a reason" is not checked.
   - `--order`'s `?? left[0]` silently prints out of order.
   - Stage heads aren't validated: gate `how`, status.
   - No check that an input `ref` produced by another item comes from an upstream item.
   - The README says all nine questions are refused when open, but `cases` and `person_prereqs` aren't in
     `readyRequired` (intended, but the docs are wrong).

10. **Medium. Missing from the ledger and cases.**
    (a) PR #110 itself drifted. 17 of its 23 commits beyond main are page, Inspector polish rounds and
        three review-lens agents (`git log origin/main..origin/claude/project-thread-3kdqwr`). Lesson: pages
        and visualisations attract polish loops, so give them a round budget and build them after a real item.
    (b) Platform facts: $.agent.spawn cwd is ignored; in `claude -p`, spawns need a live main turn (many
        verifier briefs rely on `claude -p --plugin-dir`); never store or pass `$`; threads can't start
        threads (only the coordinator can); the proxy appends a footer to PR reviews (#61); v1's mergeBound
        hook refused #110's merge (the reason for the separate project).
    (c) Audit R2: rules changed through the pipeline they govern. wf-choose-first recommends "a thread edits
        the workflow file", so a builder could edit the workflow governing its own item. Add a row and a case,
        C-builder-cannot-change-own-workflow.
    (d) What held in v1: red CI sent items back. There is no case for "red CI returns to building".

11. **Medium. Who enforces the process for the first 27 items is unspecified.**
    Builder and separate-verifier briefs are fixed in the item files, which is good. But until v2 exists,
    nothing records verdicts, blocks a merge without a PASS, or counts `step_back` rounds and tokens, and the
    journal doesn't exist for s0 items. That is L-no-trust-boundary by convention.
    Change: a plan/verdicts/<id>.md written by the verifier session, and a CI check that a PR touching an
    item's outputs has a PASS verdict at its head sha. That check is cheap and dogfoods the gate.

12. **Low. Over-specified.**
    Leave to the builder: obs-live-capture's "<50 ms p95"; exact row field lists (fingerprint, capture);
    derive file names (time.js, rework.js, overhead.js); docs/SPEC.md as an empty shell; the CLAUDE.md
    100-line test; the per-item token budgets.

13. **Low. Under-specified.**
    A builder would have to guess:
    - how wakes reach the host (who calls subscribe_pr_activity and send_later, and from which thread);
    - the grants.json shape, and how a stand-in is spawned under the classifier;
    - where the journal root lives when two projects share an account;
    - what "model served" is read from (session-fingerprint-selfcheck admits this).

---

# Answers (plan author, 2026-10-30)

| # | Answer |
|---|---|
| 1 | **Changed.** Thin path to the first real item: plan-independent-review, probe-platform-baseline, person-setup-sitting, repo-skeleton, journal-schema, env-bootstrap (merges setup-script, plugin-install, session-fingerprint-selfcheck), obs-live-capture (merges obs-briefs-and-results), wf-quick-fix (ports #110's machine), engine-host, engine-actors, engine-effects, engine-toy-run, first-real-issue: 13 items, 10 of them builds. Everything else moved to the new stage s4b-widen, ordered by the first item's retro. |
| 2 | **Changed.** first-real-issue and the toy run use a product repo picked in the setup sitting. New ledger row L-first-item-is-product. |
| 3 | **Changed.** probe-platform-baseline gains self-edit (copied vs linked install), idle-merge, page-reads-journal and cwd lines, and records fixtures. env-bootstrap installs a released copy, never a link to the working tree. xstate pinned to 5.33.3; probe-xstate-runtime parked; wf-schema's both-xstate line removed. |
| 4 | **Changed.** One owner thread and one journal file per item; restore reads one known path; journal-schema's readAll is for offline tools only. New case C-two-hosts-one-item; engine-host explains how wakes reach the owner. |
| 5 | **Changed.** obs-live-capture tests against a recorded fixture; self-update's next-session check and obs-page's refresh moved to after_landing; clean-room runs on PRs touching plugins/ or infra/; the probe's verifier reads recorded wakes instead of making them; cards are tested with a stub and a recorded tap. |
| 6 | **Changed.** Retry linking is tested on recorded refusal fixtures; nothing is refused or retried live. |
| 7 | **Changed.** New person-setup-sitting item: all rules, the stub, one rebuild, the product repo and the workflow questions in one sitting. wf-choose-first merged into it. |
| 8 | **Changed.** One workflow (wf-quick-fix) on the thin path. wf-schema, wf-fragments and wf-catalogue moved to s4b-widen behind the retro, and the "no named guard functions" line removed. |
| 9 | **Changed** check.mjs: per-row drop matching; only live items serve rows; a live item can't depend on a non-live one; dropped and parked items must say why; `--order` fails instead of guessing; stage heads validated; new `merged` status with `merged_into`. **Not done:** checking that an input produced by another item comes from a dependency, because inputs are free text; noted for when inputs get ids. |
| 10 | **Changed.** New ledger rows: L-pages-round-budget, L-spawn-ignores-cwd, L-headless-spawn-needs-live-turn, L-mods-never-store-dollar, L-threads-cannot-start-threads, L-review-footer, L-v1-gates-block-v2. New cases: C-builder-cannot-change-own-workflow, C-red-ci-back-to-building. |
| 11 | **Changed.** repo-skeleton adds a CI verdict gate: a PR into main needs a PASS review naming its head sha. |
| 12 | **Partly changed.** Removed the 50 ms limit, the empty SPEC shell and the 100-line test. Kept the row kinds, because later items name them. |
| 13 | **Partly changed.** engine-host now says how wakes reach the host; env-bootstrap says the journal root comes from install. grants.json shape and stand-in spawning stay with engine-cards-standin, which is a draft until the retro. Where "model served" is read from is a probe question. |
