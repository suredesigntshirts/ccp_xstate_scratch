# ccp-harness plugin

The v2 Claude Code plugin (plan item env-bootstrap). Sessions never load this folder: the setup script
(`infra/cloud-environment/setup.sh`) installs a copy of a release at `~/.claude/skills/ccp-harness`, where Claude
Code loads it as `ccp-harness@skills-dir`. Editing this folder changes nothing a running session uses
(ledger L-no-self-modification, L-plugins-load-at-start).

## Releases

A release is `harness-v<x.y.z>`, made by `scripts/release/release.mjs` after a merge to `main` that changes what a
session runs: `plugins/harness/` or `packages/journal/`, tests aside. The thread that merged pushes it as a branch
`release/harness-v<x.y.z>` (`node scripts/release/release.mjs branch --push`), because the git proxy drops tag pushes
from threads; `.github/workflows/release.yml` makes the same release as a tag when Actions runs. Both count as one
series, so whichever comes second makes nothing. The version only rises: the newest release's patch + 1, or
`.claude-plugin/plugin.json`'s version when that is higher. No commit is made; the script prints a `ci.result`
journal row (a tag also carries it in its annotation). The setup script installs the newest release by version,
tag or branch, and writes its version into the copy's `plugin.json`; with none it installs the clone's HEAD and says
so. The copy carries `release.json`: name, version, tag, commit and its file list. `packages/journal` is bundled
into the copy at `lib/journal`, and `packages/engine/src` at `lib/engine/src` for the actor hooks. A running session never changes its copy: a new release reaches the next session
(plan item self-update-by-version, plan/decisions/2026-10-30-self-update-by-version.md).

## The gate

The plugin is on every session the environment builds, so every hook does nothing (exit 0, no output, no writes)
unless the project installed the harness: the marker `$CCP_HARNESS_DIR/install.json` exists (default
`/mnt/project-files/harness/install.json`, one read capped at 1 s). `CCP_HARNESS_DISABLED=1` turns every hook off
even where the marker exists. Both are defined only in `scripts/host.mjs`.

**Install** with the `install` skill when the person asks: it runs `scripts/install.mjs`, which makes the journal root
`$CCP_HARNESS_DIR/journal/sessions/` and writes the marker. It takes effect from the next session.

## SessionStart

`scripts/session-start.mjs`, timeout 5 s, its own watchdog at 4 s. In an installed project it appends two rows to
`journal/sessions/<session>.jsonl` (`docs/journal.md`, "Session rows"):

- `session.fingerprint`: Claude Code version, plugin release and commit, where the copy runs from, the newest
  release on origin, the allow rules (count and hash), the subagent depth, other skills-dir plugins.
- `session.selfcheck`: one result per check, and the line below.

Then it tells the session one line: `ccp-harness 0.1.0 (harness-v0.1.0): self-check passed (6 of 6 checks).`, or
`... self-check FAILED.` followed by one plain sentence per failed check. The checks (`scripts/selfcheck.mjs`):

| Check | Fails when |
|---|---|
| `settings` | `~/.claude/settings.json` is missing or unreadable: the setup script didn't run in this container |
| `rules` | an `autoMode.allow` rule in the repo's `.claude/settings.json` (`$CCP_REPO`, default `/home/user/ccp_xstate`) isn't in `~/.claude/settings.json` |
| `depth` | `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` in `~/.claude/settings.json` isn't `3` |
| `copy` | the plugin runs from somewhere other than an installed copy (no `release.json`, a link, or inside the repo) |
| `release` | a newer release (`harness-v*` tag or `release/harness-v*` branch) is on origin (`git ls-remote`, 2 s cap; unreachable is `unknown`, not a failure) |
| `journal` | the rows could not be appended |

The check only reports. It never writes settings: a session placing its own rules is what ledger
L-rules-before-session warns of (plan/decisions/2026-10-30-setup-script-vs-sessionstart.md). The remedy for a failed
check is a new thread, which gets a new container where the setup script runs.

## UserPromptSubmit

`scripts/notice-behind.mjs`, timeout 5 s, its own watchdog at 3 s. In an installed project, at most once per 30
minutes per session, it asks origin for the newest release (tag or `release/` branch) (`git ls-remote`, 2 s cap). When that is above
the release this copy runs, the session is told: `ccp-harness: this session runs release 0.1.0, but 0.1.1
(harness-v0.1.1) is out. ...` and that a new thread runs it. It writes only its timestamp, under
`$CCP_HARNESS_STATE` (default `$TMPDIR/ccp-harness`), never under the plugin root.

## Capture

`scripts/capture.mjs` (plan item obs-live-capture), timeout 5 s, its own watchdog at 3 s, on UserPromptSubmit,
PostToolUse, PostToolUseFailure, PermissionDenied, SubagentStart, SubagentStop and Stop. On PostToolUse, PostToolUseFailure and SubagentStop
it is `async`: Claude Code starts it and goes on without waiting, so a tool call is never held up by it (a node process
takes about 40 ms idle and 60 ms under load, mostly its own start). On SubagentStop it first waits until the subagent's
transcript ends with its hand-back's result, or, for an agent that never hands back, until it stops growing (150 ms
quiet, 2 s at most), because Claude Code can still be writing the last lines.
UserPromptSubmit, SubagentStart and Stop run in line: they come once a turn or once an agent, and an async Stop hook
was lost when a headless session exited straight after it. In an installed project it appends a row per
wake, tool call, subagent start and finish and turn to `journal/sessions/<session>.jsonl`, stores each subagent's
brief and final answer once under `journal/blobs/<sha256>`, and ends with a `hook.run` row giving its own time. It
prints nothing. The rows are in `docs/journal.md`, "Capture rows"; the handlers are in `scripts/capture-rows.mjs`, and
the tests replay a recorded session (`test/fixtures/capture/`, remade by its `make.mjs`) through them. The Stop
handler keeps how far it read the transcript under `$CCP_HARNESS_STATE`, never under the plugin root.

It is a settings hook, not a mod: mods load only after the person turns them on for each session, and hooks carry
every field the rows need (plan/decisions/2026-10-30-capture-by-hooks.md).

### Refusals

Capture also journals a `refusal` row for every refused call (plan item obs-refusal-log; `docs/journal.md`, "Refusal
rows"). An auto mode classifier refusal comes live on PermissionDenied, which it handles in line. A hook's or a
permission rule's denial fires no hook, so the Stop and SubagentStop handlers find them in the transcript. A later call
of the same action (same tool and input, minus its `description`) links back to the refusal by `retryOf`; the session's
refusals so far are kept under `$CCP_HARNESS_STATE` for that. `test/fixtures/refusals/deny-hook/` is a test plugin
whose PreToolUse hook denies any Bash command containing `ccp-refusal-probe`: load it with `--plugin-dir` beside this
one to see a hook denial journalled.

## Tests

`test/` here and `test/setup.test.mjs` at the root run the real setup script into temp HOMEs and the hook as Claude
Code runs it. The tests install the working tree as a commit (`git stash create`, else HEAD) through `CCP_SETUP_REF`, so an
uncommitted change is what they test.

## Actors

`scripts/actors.mjs` (plan item engine-actors) starts, binds, confines and checks the agents a workflow invokes, on
PreToolUse, SubagentStart, UserPromptSubmit and PostToolUse of Agent; the logic is `packages/engine/src/actors.js`
(`packages/engine/README.md`, "Actors"). `.mcp.json` registers one MCP server, `harness`
(`scripts/return-tool.mjs`), with one tool, `return`. The hook checks every call before it reaches the server; the
server only answers whether the hook stored that result, so a return with the hook absent is never accepted.
