# Platform baseline

**Date:** 2026-10-30, 10:10Z to 10:30Z (first thread, no rules in force) and 11:35Z to 11:45Z (rerun thread, rules in force)
**Claude Code:** 2.1.314 (built 2026-10-29T20:53:59Z), from the mod's `$.session.version()` and `claude --version`
**Model served:** the thread ran on `claude-opus-5-5` (session `configured_model` and `last_served_model`). Headless
`claude -p` children ran on `claude-sonnet-5-5`; subagents the mod spawned ran on `claude-opus-5-5` in the live thread
and `claude-sonnet-5-5` headless.
**Where:** a Projects cloud thread in the v2 project (`ccp_xstate`), permission mode auto, plus headless
`claude -p --permission-mode auto` children in the same container.
**Probe code and evidence:** `probes/platform/` (commands in its README), raw logs in `probes/platform/fixtures/`.

## Read this first: which rules were in force

**First thread (10:10Z to 10:30Z):** the container started "resume-cached" and `/tmp/env-manager.log` says "Skipping
initialization script for faster startup". `infra/cloud-environment/setup.sh` never ran, so `~/.claude/settings.json`
did not exist: none of the repo's `autoMode.allow` rules were in force and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` was 1.

**Rerun thread (11:35Z to 11:45Z):** after the person re-saved the setup script, a new thread got a new container
(env-manager `session_mode: "new"`, "Running initialization script" at 11:35:46Z). The setup log says
`autoMode.allow rules: 8` (the repo's 7 plus `$defaults`), and `~/.claude/settings.json` sets the depth to 3. The
person turned on this thread's mods at about 11:37Z, so the probe mod ran inside the live thread. Evidence:
`fixtures/runs/2026-10-30-rerun-setup.log`, `-rerun-env-manager-excerpt.jsonl`, `-rerun-user-settings.json`.

The idle-wake rows below were run under both conditions and came out the same: allowed.

## Results

| Assumption (ledger) | Answer | Evidence |
|---|---|---|
| A mod's `$.agent.spawn` runs on a send_later wake with no person message (L-classifier-judges-the-request) | **Holds: allowed** under the pre-placed rule (rerun 11:39Z, agent `aff13d6645cb8bf25` answered `/home/user ok`) and with no rule (10:21Z). v1's 28 Oct refusal did not reproduce. | `fixtures/wakes/2026-10-30-rerun-send-later-wake.json`; `fixtures/wakes/2026-10-30-send-later-wake.json` |
| A mod's `$.agent.spawn` runs on a GitHub PR event wake with no person message (L-classifier-judges-the-request) | **Holds: allowed** under the pre-placed rule on two wakes: `check_suite.completed` (11:37:30Z, agent `aca0bdb3d6deb2152`) and `pull_request.closed` (11:38:14Z, agent `a261b5f2014332f3e`), both mod spawns that answered. Also allowed with no rule (10:19Z, 10:24Z). | `fixtures/wakes/2026-10-30-rerun-pr-event-wake.json`; `fixtures/wakes/2026-10-30-pr-event-wake.json` |
| The thread's model may spawn with the Agent tool on either idle wake (fallback host design) | **Holds: allowed** on both wake kinds, with and without the rules. | the four wake fixtures, `model_spawn` |
| A merge through the GitHub merge tool on an idle wake (L-merge-without-review-flag) | **Allowed** under the pre-placed rule: ccp_xstate_scratch#2 on a send_later wake (11:39Z, merge sha eda4cdfb) and #3 on a PR event wake (11:37Z, sha 432918c5). Also allowed with no rule (#1, 10:21Z). No [Merge Without Review] flag, and later calls were not denied. | `fixtures/wakes/2026-10-30-rerun-send-later-wake.json`, `-rerun-pr-event-wake.json` (`model_merge`); `fixtures/wakes/2026-10-30-send-later-wake.json` |
| A mod spawns from a timer with no turn at all | **Allowed** headless (`$.clock.after`, run 2). | `fixtures/runs/2026-10-30-runs-1-2.jsonl`, label `timer` |
| What a mod sees of a wake | **Only a summary.** Both wake kinds reach `turn.start` as the same `<task-notification>` "queued-remote-notifications" text. The body (send_later message, GitHub event JSON) comes only from the model's `ReadNotifications` call. A mod can tell *that* a wake came, not *what* it says. | both wake fixtures, `turn_text_as_mod_saw_it` |
| `$.mcp.call` reaches the project's thread tools from a mod (L-mods-capabilities) | **Holds** in a live thread: `hearthbot.read_thread`, `hearthbot.request_decision` (card posted, then closed by the thread) and `claude-code-remote.send_later` (trigger created) all returned `isError: false`. Headless it doesn't: those servers aren't connected in `claude -p` ("no connected MCP tool"). | `fixtures/wakes/2026-10-30-pr-event-wake.json` (`second_wake.mod_mcp_calls`); `fixtures/runs/live-thread.jsonl`; run 1 lines `probe:"mcp"` |
| `$.agent.spawn` honours `cwd` (L-spawn-ignores-cwd) | **Doesn't hold.** Asked for `/tmp/probe-cwd-target`, the subagent's `pwd` was the parent's `/tmp`, twice (runs 1 and 2). What works instead: subagents start in the session's working folder (the live thread's `pwd` followed the session's current directory), so name the folder in the brief and have the agent `cd` there. | runs 1-2 lines `"label":"cwd"`; smallest repro in the README |
| How a classifier refusal shows to the model, hooks and a mod | **To the model:** a tool_result error, "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Category]. ..." **To settings hooks:** a `PermissionDenied` hook fires with `tool_name`, `tool_input`, `tool_use_id` and `reason: "[Self-Modification]"` (the category only); no PostToolUse fires. **To a mod:** `tool.call`'s `await next(e)` resolves `isError: true` with the full refusal text in `text`, and `deny` is unset. So a mod can't tell a classifier refusal from a tool error except by the text. The debug log also has `Auto mode classifier blocked action: [Category]`. Captured live at 11:34Z, when this thread tried the SessionStart probe below (a real refusal, not a staged one). | `fixtures/refusals/2026-10-30-self-modification-live-mod-and-hook.jsonl`, `fixtures/refusals/` (the two earlier refusals and the debug log excerpt) |
| Retrying after a refusal reads as a bypass (L-retries-look-like-bypass) | Not re-tested. The second refusal ([Self-Modification]) was a different action with the intent stated; it was refused too. Stopped there. | `fixtures/refusals/2026-10-30-self-modification-outer.json` |
| Subagent depth (L-subagent-depth) | **Holds: the value is the number of subagent levels.** At `1` the first subagent has no Agent tool (builder's runs 3 and 10:27Z, and the rerun at 11:38Z). At `3` levels 1 and 2 have an Agent tool and level 3 doesn't (`nested-3-ok`, twice at 11:37Z, and the verifier's earlier run). Why the verifier's `=1` reruns reached a second level: an `env` in `~/.claude/settings.json` overrides a shell variable, so `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 claude -p ...` still ran at the settings value (a child echoed `depth=3`). Pass the value with `--settings` (README). Set it in settings and have the self-check spawn one nested agent. | `fixtures/runs/2026-10-30-rerun-depth.txt`; `fixtures/runs/2026-10-30-results.jsonl` runs 3 and 5, `fixtures/runs/2026-10-30-depth-rerun.txt` |
| SessionStart settings hook budget (L-hook-time-budget) | **No timeout set: at least 70 s;** the session waited the full 70 s before starting. **`timeout: 5`: killed at 5 s** (4 ticks, no end line). | runs 3-5 log (70 s), `fixtures/runs/2026-10-30-run-6-configured-timeouts.jsonl` |
| PreToolUse settings hook budget | **No timeout set: at least 20 s,** the tool waited. **`timeout: 5`: killed at 5 s.** | runs 1-2 log (20 s), run 6 log |
| A mod hook's budget | **Declared 10,000 ms** (`next.budget` read `{ms: 10000}`), but a 15 s busy loop in `turn.start` was **not** aborted (`next.signal.aborted` stayed false) and its later `$` calls (two spawns, a timer) still ran. The turn did not wait for it: the model's first tool call came 2 s in. Treat 10 s as a soft budget on `turn.start`; don't put work there that the turn needs. | runs 1-2 log `probe:"mod-budget"` |
| A thread may commit under `plugins/` while a released copy of that plugin is loaded (L-no-self-modification) | **Allowed.** Commit 6d56840 in ccp_xstate_scratch, branch `probe/self-edit-released`, changes `plugins/effect-harness/hooks/register.ts` while the session ran the released `effect-harness`. Pushed, no refusal. | `git -C ccp_xstate_scratch show 6d56840` |
| ...and when the session loads the working tree | **Allowed** headless: a `claude -p` session with `--plugin-dir plugins/platform-probe` edited and committed that plugin's `register.ts`. The live thread also edited its own loaded dev mod (hot-reloaded) with no refusal. Settings are different: asking a child to add an allow rule to its own project settings was refused [Self-Modification] in the outer thread. | `fixtures/runs/2026-10-30-run-3-self-edit-git-log.txt`; `fixtures/refusals/2026-10-30-self-modification-outer.json` |
| Plugins load at start; edits change nothing mid-session (L-plugins-load-at-start) | **Partly changed.** Mods written to the session's mods folder hot-reload at the end of the turn that edits them, once the person turns mods on. Each reload ran `session.start` again (log shows four). Plugins from `--plugin-dir` and marketplaces still load at start. | `fixtures/runs/live-thread.jsonl` `session.start` lines |
| Headless spawns need a live main turn (L-headless-spawn-needs-live-turn) | **Holds in practice**: in run 2 the main turn stayed alive because the model waited for its subagents; the timer spawn fired 5 s after its turn hook. | runs 1-2 log |
| Rules work only if placed before the session (L-rules-before-session) | **Not separable here:** the idle-wake actions the rules cover were allowed both without them and with them placed before the session, so the probe can't show the rules doing anything. Not run with self-placed rules (that reads as a bypass). | this section |
| GraphQL blocked, REST only (L-graphql-blocked) | **Untested** this run. The GitHub MCP tools (REST) worked for PR create, merge and subscribe. | — |
| A page reads a Library JSONL through `files` | **Holds.** The project owner opened the page. `files.list` found `probes/platform/probe-journal.jsonl` and `files.read` returned 1488 bytes (revision 6eb7ee3d…), and all 4 JSONL rows parsed, on 4 loads between 11:30Z and 11:32Z. The read asks the viewer once; a viewer outside the project gets `not_found`. | `fixtures/runs/2026-10-30-page-read-results.json` (from the page's db), https://claude.ai/artifact/YUMK21WxirbJgGCE7ppaQj |
| A `claude -p` child loads the parent session's mods folder | **Observed:** run 6, started after the person turned mods on, logged the dev mod's `session.start` (it shares the parent's session id). Check this before using headless runs as clean rooms. | `fixtures/runs/live-thread.jsonl` first two lines |

## Setup script vs SessionStart

The person asked whether a SessionStart hook or mod should keep the settings current instead of, or as well as, the
setup script. What was seen:

- **Setup script:** runs when a container is built for a new session. A thread resumed on a cached container skips
  it: env-manager logged "Skipping initialization script for faster startup" at 10:07Z, and again at 11:33Z after the
  person re-saved the script. A re-save reaches new threads, not running ones.
- **A new thread gets a new container, and the script runs:** the rerun thread started 11:35Z with env-manager
  `session_mode: "new"` and "Running initialization script"; the settings were there. So after a re-save, the fix
  for a running thread is a new thread, not a hook.
- **Repo `.claude/settings.json`:** never loads here. Threads start in `/home/user`, not the repo
  (L-repo-skills-dont-load), so only `~/.claude/settings.json` counts.
- **A SessionStart hook started from inside the thread:** refused. This thread tried a `claude -p` child whose
  plugin SessionStart hook runs `setup.sh`, with the person's ask stated in the prompt. Auto mode denied it as
  [Self-Modification] before the child started (11:34Z). A thread placing its own rules is the case
  L-rules-before-session warns about. It was not retried.
- **Not tested:** a SessionStart hook in a plugin the person installs, which runs before the thread's first turn
  with no classifier in the way. Settings it writes probably land after the session read its settings, so they
  would count from the next start or resume, not the current session.

Decided (plan/decisions/2026-10-30-setup-script-vs-sessionstart.md), for setup-script and env-bootstrap: keep the setup script as the way rules arrive. Add a SessionStart
hook in the v2 plugin that only *checks*: is `~/.claude/settings.json` there, are the rules in it, is the depth 3.
When something is missing, it says so loudly at session start and records it. Whether that hook should also write
the settings (for the next resume) is a one-way door about settings, so it is for the person, on
waiting-for-person.md.

## What this changes for later items

- **engine-host:** the host can be a mod reacting to wakes. Spawns from `turn.start` on both wake kinds were
  allowed with no rules in force. But the mod can't read the wake's body, so the host must either keep its own
  record of what it scheduled and why, or let the model read notifications and hand the body to the mod (a mod tool).
- **env-bootstrap / setup-script:** a cached container can skip the setup script. The self-check must test for
  `~/.claude/settings.json` and the depth value, not assume them.
- **engine-actors:** give each actor its folder in the brief (cwd is ignored). Don't rely on a hook budget for
  `turn.start` work; use `$.clock` or `session.start`.
- **obs-refusal-log:** a classifier refusal fires no PostToolUse. Capture it from the debug log line or the tool
  result text; whether a mod's `tool.call` sees `deny` for a classifier refusal is still open.
- **L-classifier-judges-the-request, L-merge-without-review-flag:** both were allowed with no rules and again with the
  rules in force. Keep the rules anyway in case the classifier changes.

## Allow rules

The full v2 set, in plain words, for person-setup-sitting. The first seven are already in `.claude/settings.json`
on main; the probe found nothing that needs more. One-line summary of each:

1. The probe mod may start subagents on any wake, including timer and GitHub event wakes (probe only).
2. `claude -p --plugin-dir probes/platform` headless probe runs are allowed.
3. The probe may merge PRs in the scratch repo on any wake.
4. The person delegated the plan to Claude threads: branch, commit, push, open PRs and issues, and merge their own
   PRs in both repos when CI is green at the head sha and an independent verifier passed that sha.
5. Threads may start builder and verifier subagents (Agent tool or a mod's `$.agent.spawn`) on any wake.
6. Editing and committing under `plugins/`, `packages/`, `probes/`, `infra/` and `verify/` is building the product,
   not self-modification. `.claude/settings.json` is excluded and waits for the person.
7. In ccp_xstate_scratch, threads may open, push to, make red, merge, revert and close scratch PRs on any wake.

None of these were in force in the first thread; all were in force in the rerun thread (11:35Z on).

## Verdict and what is left

The first verifier (at 4239dac) marked 6 Expect lines MET and 5 NOT MET. The rerun thread answered all five:
idle-spawn and idle-merge under the pre-placed rules (fixtures `2026-10-30-rerun-*-wake.json`), depth (above),
page-reads-journal (opened by the person at 11:30Z) and hooks-see-refusals (live refusal at 11:34Z). A new
independent verifier checks the whole report again before merge (verify/probe-platform-baseline/verdict.json).
