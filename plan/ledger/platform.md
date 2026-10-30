# Platform: auto mode, settings, plugins, containers

### L-no-self-modification
**Lesson:** Auto mode refuses a thread that edits the plugin, hooks or settings its own session is running, even with the person's written authorization.
**Evidence:** Three threads were refused [Self-Modification] editing `plugins/harness/hooks/status.tsx` on 28 Oct, then [Auto-Mode Bypass] on retries. Builder subagents were refused committing a `.claude/settings.json` change (29 Oct). Building a separate plugin (`plugins/orchestrator`, ccp_machine PR #110) was never refused.
**Fate:** design. The repo that builds v2 is never the plugin the building session loads. Updates reach sessions through a released plugin version.

### L-rules-before-session
**Lesson:** Allow rules work only if they exist before the session starts. Rules a session adds itself make the classifier treat the same command as a bypass.
**Evidence:** After a thread added its own salvage rules, every page save was refused as [Auto-Mode Bypass] (28 Oct, 10:4x). With rules pre-placed by the person and a container rebuild, about 320 salvage calls ran with zero refusals.
**Fate:** setup. Each stage lists its allow rules under `person_prereqs`, placed and rebuilt before its first thread.

### L-rules-name-the-work
**Lesson:** Allow rules phrased in one system's terms don't cover another's actions.
**Evidence:** v1's `autoMode.allow` entries speak of "the lead", "the store" and "the stand-in". v2's mod spawns and merges fall outside them, and the 28 Oct mod spawn was refused.
**Fate:** setup. v2's rules describe v2's actions in plain words (the host spawning builders and verifiers, merging at a verified head).

### L-classifier-judges-the-request
**Lesson:** Auto mode judges an action by the request behind the turn. A spawn or merge on a timer or event wake with no person request is refused.
**Evidence:** A mod's `$.agent.spawn` was refused on a scheduled wake ("the request that produced this action did not ask for one") but succeeded in a fresh thread whose brief carried the person's approval (Library: notes/mods-probe-2026-10-28/). A coordinator's brief alone was not enough authority for a store write (29 Oct).
**Fate:** test. Before the engine relies on it, a probe must show a spawn from an idle wake allowed under a standing rule. If it stays refused, the host design changes.

### L-retries-look-like-bypass
**Lesson:** Retrying after a refusal, or resuming an agent to retry, reads as a bypass and makes things worse.
**Evidence:** Stand-in answers refused [Auto-Mode Bypass] on retry by a resumed agent (28 Oct 14:1x). CLAUDE.md now says: retry once with the intent stated, then stop.
**Fate:** design. The host never auto-retries a refused action. It records the refusal and routes it as a step-back.

### L-merge-without-review-flag
**Lesson:** A lead landing its own PR is flagged [Merge Without Review] unless a rule says who may land and on what evidence. After that flag, even read-only calls get denied.
**Evidence:** 29 Oct 04:12, after the lead landed #115, two read-only Bash calls were denied.
**Fate:** setup. The v2 rule names the merge: the host merges at `verdict.sha` after an independent PASS and green CI.

### L-plugins-load-at-start
**Lesson:** Plugins, hooks, skills and mods load once at session start or resume. Editing them mid-session changes nothing.
**Evidence:** Repeatedly seen (28 Oct mod probe; 27 Oct stale hook stamps).
**Fate:** design. Self-update means a new version that takes effect at the next session, with the running version recorded.

### L-repo-skills-dont-load
**Lesson:** A repo's `.claude/skills` and `.claude/settings.json` don't apply in Projects cloud threads. Only a plugin or a setup script reaches them.
**Evidence:** The documentation-downloader skill was absent from a thread's skill list. The subagent depth setting in the repo had no effect, but the same setting via the setup script worked (26 Oct).
**Fate:** setup. Everything v2 needs ships in its plugin, installed by the setup script and gated on a per-project install marker.

### L-setup-script-stub
**Lesson:** Paste a tiny stub into the environment that runs the repo's setup script from the fresh clone. A pasted full copy goes stale.
**Evidence:** ccp_machine#19, verified 27 Oct 14:11 in a fresh thread.
**Fate:** setup.

### L-subagent-depth
**Lesson:** Cloud threads start with subagent depth 1. Depth 3 needs `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` written to `~/.claude/settings.json` by the setup script.
**Evidence:** Verified 26 Oct 15:05: a nested spawn worked after the setup script.
**Fate:** setup.

### L-container-is-ephemeral
**Lesson:** Anything in the container (scratchpad, local transcripts, worktrees, symlinks) is lost on reclaim. A fresh container must recreate its working setup.
**Evidence:** Leads repeatedly had to recreate `/home/user/harness-run` and the `.harness` symlinks. Outcomes files and briefs lived only in a scratchpad (27 Oct).
**Fate:** design. The start-of-session self-check rebuilds working state from durable sources. Nothing durable lives only in the container.

### L-library-mount-slow
**Lesson:** The shared Library mount is slow when cold (about 100 ms per open, about 85 opens a second), has no locks, and other sessions see writes about 40 seconds late.
**Evidence:** A hook that read about 3,700 call files took over 6 minutes and blew its 30-second budget, so spawns stopped binding (ccp_machine#116).
**Fate:** design. Journals are append-only with one writer per file. Hooks never scan folders, and hot paths read one known file.

### L-mods-capabilities
**Lesson:** Mods can spawn subagents and get answers by id, register tools, set timers, and call this project's MCP tools (`$.mcp.call("hearthbot", …)`). They don't enforce registered tool schemas, don't skip permissions, and their registered tools are visible to subagents.
**Evidence:** Probes on 28 Oct, headless and in real Projects threads (Library: notes/mods-probe-2026-10-28/). Mods are early access (Claude Code 2.1.277-2.1.312).
**Fate:** test. A probe item re-checks these on the Claude Code version v2 targets, and the result is recorded with that version.

### L-hook-time-budget
**Lesson:** Hooks have tight time budgets (5 to 30 seconds as configured, about 10 seconds in mods), and a slow hook silently drops its work.
**Evidence:** The bind timeout in ccp_machine#116. In mods, `$.process.run` time doesn't count against the budget.
**Fate:** measure. Every hook run's duration and timeout is recorded.

### L-graphql-blocked
**Lesson:** From sessions, GitHub GraphQL is refused (REST only), commit statuses can't be posted (proxy 403), and `gh` reaches only repos attached to the session.
**Evidence:** 26 Oct and 27 Oct measurements.
**Fate:** design. v2 uses REST and the GitHub MCP tools only, and never needs GitHub Projects v2 or commit statuses from a session.

### L-message-caps
**Lesson:** The platform caps messages (about 20 per thread and 60 per project per hour, verified by the person).
**Evidence:** Library: skills-sources memory.
**Fate:** measure. The host counts its own posts and stays under the caps.

### L-spawn-ignores-cwd
**Lesson:** A mod's `$.agent.spawn` ignores cwd (Claude Code 2.1.312), so an agent's working folder must be set by its brief.
**Evidence:** Observed building ccp_machine PR #110 (28 Oct).
**Fate:** test. probe-platform-baseline re-checks it, and engine-actors gives each actor its folder through the brief.

### L-headless-spawn-needs-live-turn
**Lesson:** In `claude -p`, mod spawns need a live main turn; a hook has about a 10-second budget, but `$.process.run` time doesn't count.
**Evidence:** PR #110's headless runs (28 Oct).
**Fate:** design. Verifier briefs that run headless sessions keep the main turn alive until spawned agents answer.

### L-mods-never-store-dollar
**Lesson:** A mod must never store or pass its `$` handle, run `claude plugin validate`, and check the plugin tests' rules before relying on `$.fs`.
**Evidence:** The XState plan doc's "Mod rules" (28 Oct).
**Fate:** design. A lint test in the plugin package.

### L-threads-cannot-start-threads
**Lesson:** Only the coordinator starts threads, so a thread-hosted harness uses subagents for workers, or asks the coordinator.
**Evidence:** Audit R7, corrected: subagents were available and unused; threads can't start threads.
**Fate:** design. Actors are subagents. Thread actors wait until a real item needs one.

### L-review-footer
**Lesson:** The session proxy appends a footer to every PR review, so any check reading a review body must allow it.
**Evidence:** ccp_machine#61 (PR #66, two FAILs) after the first real PR hit the gate.
**Fate:** design. The verdict gate reads the review's state and sha, and treats the footer as a named constant.

### L-v1-gates-block-v2
**Lesson:** v1's hooks refuse v2 work done in v1's project (its merge gate refused PR #110, which had no v1 item).
**Evidence:** 28 Oct 18:50, PR #110 left unmerged.
**Fate:** setup. v2 runs in its own project, whose environment doesn't load v1's plugin.
