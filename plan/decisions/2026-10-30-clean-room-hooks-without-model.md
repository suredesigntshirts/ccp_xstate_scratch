# Clean room: how the session runs, and how a missing plugin file is named

**Date:** 2026-10-30, by the clean-room-install-test thread, on the person's standing instruction to decide two-way
doors and not wait.

**What was seen:** in a thread container, `claude -p --output-format stream-json --verbose` with an empty HOME
(only the setup script's files) and an empty project ran ccp-harness's SessionStart hook and showed its output as a
`hook_response` event before any model call. The repo has no `ANTHROPIC_API_KEY` secret that a thread can see, and
adding one is a settings change. Before this item the self-check did not look at the plugin's own files: a copy
missing `scripts/notice-behind.mjs` passed, and one missing `scripts/fingerprint.mjs` crashed the hook before it
said anything.

**Choice:**

1. `scripts/clean-room/run.mjs` starts a headless `claude -p` session when `ANTHROPIC_API_KEY` is set, and otherwise
   runs the plugin's SessionStart hooks from its installed `hooks/hooks.json` as Claude Code runs them (the
   command through `sh -c`, `CLAUDE_PLUGIN_ROOT` set, the hook input on stdin), with no model. Both modes are run
   by the thread; CI runs the second until the secret exists. The item's `person_prereqs` names this fallback.
2. The self-check gets a `files` check: from what Claude Code reads (plugin.json, hooks.json and its commands, each
   skill and the script it names, the bundled journal) it follows every relative import and names each missing
   file and what needs it. `session-start.mjs` imports its own modules inside a try, so a copy missing one of them
   still says which file is gone.
3. The clean-room job runs on PRs touching `plugins/`, `packages/journal/`, `infra/` or itself (installing the PR's
   own commit), on every release branch or tag push (installing the newest release, as a container build does),
   and by hand.
4. The "catches" proof runs in ccp_xstate_scratch: a PR there carries this branch's tree with one plugin file
   deleted. The scratch repo already has a `release/harness-v0.1.2` branch from earlier probes, so the scratch
   tree's plugin version is set to 0.1.2, or the release check would fail too and blur which check went red.

**Why:** a clean room that needs a key nobody has added proves nothing today; the hooks are the part that depends
on the install, and the model adds nothing to the self-check. Naming the missing file is what lets a red run be
read in one line (`docs/selfcheck.md`).

**Waits on the person:** adding the `ANTHROPIC_API_KEY` secret, if a real session in CI is wanted
(`waiting-for-person.md`).
