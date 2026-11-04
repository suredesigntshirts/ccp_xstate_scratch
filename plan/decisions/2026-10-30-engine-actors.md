# How the engine's actors are built

**Date:** 2026-10-30
**Decided by:** the engine-actors thread (two-way doors; the person was away)

What Claude Code 2.1.314 does, probed headless in this thread before building (`claude -p --plugin-dir`, a throwaway
plugin): a PreToolUse hook's `updatedInput` replaces an Agent call's `prompt`, and the subagent's transcript starts
with the replaced text; it works with no `permissionDecision`, so the normal permission flow still decides the call.
SubagentStart's `additionalContext` reaches the subagent. Subagents' PreToolUse inputs carry `agent_id`. A plugin's
`.mcp.json` server `harness` shows its tool as `mcp__plugin_<plugin>_harness__return`. SubagentStart runs before the
agent's transcript and `meta.json` exist, and Claude Code waits for it, so it can't read the spawning call's id.

- **Subagents, started by the session's Agent call, with the brief swapped in by a hook.** The host can't spawn an
  agent itself: mods are off until the person turns them on, and a hook can't call a tool. So the run handler
  prepares the run and the session calls the Agent tool with `ccp-run <run>`; the harness's PreToolUse hook replaces
  that with the run's brief. The prompt the agent receives is the brief byte for byte, whatever the session typed, so
  its hash is the `briefHash` journalled when the run was prepared. A second Agent call for a run is refused.
- **The prompt is the brief alone; run details come as SubagentStart context.** Expect `fixed-before-build` wants the
  verifier's prompt to hash to a brief fixed before the builder starts, but the run id and worktree only exist once
  verifying starts. So the brief is the prompt, and the run, worktree, schema and input go in the agent's added
  context (also kept as `context.md`, hashed in `brief.stored`). A `brief` actor's returned briefs are journalled as
  `brief.stored` when accepted, so the verifier's brief is fixed before the build run is even prepared.
- **Binding by the session's one started run, checked against meta.json.** SubagentStart binds the new agent to the
  session's one run whose Agent call has no agent yet. With several starting at once it binds nothing, and the
  agent's first tool call binds it from `meta.json`'s `toolUseId` (exact), refusing that one call with the run's
  context so the agent reads it. An agent bound at SubagentStart is checked against `meta.json` at its first call;
  a mismatch is refused (`bind-mismatch`).
- **The return tool's checks live in its PreToolUse hook, not the MCP server.** An MCP server doesn't learn which
  agent called it; the hook does (`agent_id`). The hook refuses with the rule first (`wrong-caller: ...`), so capture's
  refusal rows name it too. The server accepts only when the hook stored exactly this result for this run, so with
  the hook absent (a crash, an older release) nothing is accepted. The tool is `mcp__plugin_ccp-harness_harness__return`
  as Claude Code names a plugin's tool; the item's `mcp__harness__return` is the same server and tool, and the hook
  matches both.
- **GitHub facts by REST from the hook.** Any `{ url, headSha }` in a result is read from GitHub
  (`effects/github.js`, the proxy tunnel engine-effects built): no such PR, another head or another branch is refused
  naming the fact, and the item stays where it was. `CCP_GITHUB_API` points the hook at a test server.
- **An accepted result goes to the item at once, and again on any later host run.** The hook calls `deliver()`, which
  restores the item as its owner and offers the run's done event; its source is `harness` and the return's tool use
  id, a record the host's own check made (like engine-host's timer source). `bin/host.js` offers any accepted result
  the item hasn't taken on every call, so a failed delivery isn't lost.
- **Worktrees by git, and confinement by the hook.** Each run gets `git worktree add` at `<worktrees>/<item>--<run>`
  on `run/<item>/<run>` (scratch names carry the item). `cwd` is ignored by spawns (platform baseline), so a bound
  agent's Bash command is rewritten to run in a subshell that starts in the worktree, and file tools naming a path
  outside it are refused (`own-folder`). This is the one shell command an effect runs; engine-effects' "no shell"
  was about reaching GitHub, which still goes over REST.
- **`paths` on actors' tool.call rows only.** obs-live-capture keeps no tool input in rows. Expect `own-folder` needs
  the paths, so capture adds `paths` only to the tool.call rows of an agent bound to a run, the way `pr.merge` keeps
  its identifiers. Ordinary sessions and subagents are unchanged, so obs-live-capture's no-content tests still hold.
- **engine-host's verifier test narrowed.** `verify/engine-host/plugin-tools.test.mjs` said the plugin has no
  `.mcp.json` and no script names `packages/engine`. This item's output is that tool, so the test now says the plugin
  has exactly this one server and tool, which takes no event or source, and that only the actor hook loads the
  engine; no plugin script reads wakes or applies events. The engine-actors verifier is asked to check this change.
- **The installed copy bundles `packages/engine/src` at `lib/engine/src`** (setup.sh), so the hook's checks run from a
  release. XState isn't bundled, so `deliver()` fails there and the result waits for the next `bin/host.js` call;
  the toy run decides whether the plugin carries XState.
- **The person prereq is already met.** The allow rule "Threads may start builder and verifier subagents (Agent tool
  or a mod's `$.agent.spawn`) on any wake" has been in `.claude/settings.json` since probe-platform-baseline.

What stays open: a hook crash lets an actor's call through unconfined (fails open for confinement, closed for
returns); an agent with a shell can write run files by hand, as it can append journal rows (ledger
L-same-account-everywhere). Not observed live: this thread runs the cached 0.1.0 snapshot (see the s1 gate), so its
own calls are not captured; every run here was headless with `--plugin-dir plugins/harness`.
