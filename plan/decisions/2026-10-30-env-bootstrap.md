# env-bootstrap: where the plugin lives, what a release is, what the self-check checks

**Date:** 2026-10-30, by the env-bootstrap build thread, on the person's standing instruction to decide two-way
doors and not wait. All of these are plugin or script code and can be changed by a later PR.

1. **Install location: a copy at `~/.claude/skills/ccp-harness`.** Claude Code loads a folder there holding
   `.claude-plugin/plugin.json` as `<name>@skills-dir`, with its hooks, and no `enabledPlugins` entry. Seen
   11:51Z in this container: a headless `claude -p` with a temp HOME loaded such a folder, ran its SessionStart
   hook and passed its `additionalContext` to the model. v1 linked its plugin there; v2 copies it, extracted from a
   git commit, so the working tree is never what runs (L-no-self-modification). A local marketplace
   (`claude plugin install`) was not used: it writes install timestamps, so two setup runs would differ.
2. **A release is a tag `harness-v<x.y.z>`** matching `plugins/harness/.claude-plugin/plugin.json`. Setup installs
   the newest by version sort; with none, the clone's HEAD, and the fingerprint shows `tag: null`.
   self-update-by-version makes the tags on merge; until then this thread pushes the first one by hand if allowed.
3. **Plugin name `ccp-harness`**, folder `plugins/harness`, so a fingerprint can't be confused with v1's `harness`.
4. **Marker and journal under `/mnt/project-files/harness/`**: `install.json`, and `journal/sessions/<session>.jsonl`
   (one writer per file, docs/journal.md). `CCP_HARNESS_DIR` moves both, `CCP_HARNESS_DISABLED=1` silences the hooks.
5. **Self-check ids:** settings, rules, depth, copy, release, journal. Rules are compared with the repo clone's
   `.claude/settings.json`, so a cached container with older settings than the clone is caught. A spawn test of
   depth (platform-baseline's suggestion) can't run from a hook, so the check reads the setting.
6. **Newest release by `git ls-remote --tags origin`**, capped at 2 s, not by GitHub REST: Node's fetch doesn't use
   the container's HTTPS proxy without extra setup, and git already reaches GitHub through it. Unreachable is
   `unknown`, not a failure. Still GitHub only, per the item's non-goal.
7. **`model` is null in the fingerprint.** SessionStart's input has no model field (seen 11:51Z, Claude Code
   2.1.314); the served model comes with turn rows (obs-live-capture). `claude_code` comes from `claude --version`,
   because `CLAUDE_CODE_VERSION` in the environment read 2.1.42 while the CLI was 2.1.314.
8. **Session naming:** `CLAUDE_CODE_REMOTE_SESSION_ID` reads `cse_<id>` where the session URL says `session_<id>`,
   so the hook swaps the prefix to journal under the Claude-Session URL.
9. **`session.selfcheck` added to the journal's kinds** (docs/journal.md, "Session rows").
