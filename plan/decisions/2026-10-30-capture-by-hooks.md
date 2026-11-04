# Capture by settings hooks, not a mod

**Date:** 2026-10-30, by the obs-live-capture thread, on the person's standing instruction to decide two-way doors and
not wait.

**The item asked for** "plugins/harness/hooks/capture (mod module, with a hooks fallback)".

**What was seen** (a `claude -p` session on Claude Code 2.1.314 with a plugin logging every hook's input, recorded as
`plugins/harness/test/fixtures/capture/`):

- PostToolUse carries `tool_use_id`, `duration_ms` and, inside a subagent, `agent_id` and `agent_type`; the main
  session's calls carry no `agent_id`. That is the attribution the item wants, with no guessing.
- SubagentStart carries the new agent's id and type. The agent's transcript, whose first line is the brief, and a
  `meta.json` naming the spawning tool use id already exist when it runs. SubagentStop carries the agent's
  transcript path, from which its tokens, time and final answer (its SubagentHandback message) are read.
- UserPromptSubmit carries the prompt (the wake) and Stop the transcript path (turn tokens).
- Mods a thread writes load only after the person turns them on in each session
  (plan/decisions/2026-10-30-setup-script-vs-sessionstart.md), and a mod's hooks see the same calls.

**Choice:** capture ships as settings hooks in the harness plugin (`scripts/capture.mjs`, handlers in
`scripts/capture-rows.mjs`), on every session the setup script builds. No mod module is built now. If a later item
needs a mod (engine-host), it can import `capture-rows.mjs`, whose handlers take a hook-shaped input and write nothing.

**Why:** the hooks carry every field the rows need and run without the person, so the "fallback" covers everything;
a mod would add a second path that only runs where the person has switched mods on.

**Async on tool calls.** The PostToolUse and PostToolUseFailure capture hooks are declared `"async": true`. A probe on 2.1.314 (a PostToolUse hook doing `sleep 3`
marked async) showed the next tool call start 1.1 s after the previous one ended, not 3 s, while the hook still
finished and wrote. The verifier measured capture's own run at a 60 ms median in live sessions (42 ms in the idle
fixture run), of which about 22 ms is node starting. Run in line, that would put 60 ms on every call, over the item's
50 ms; run async, the call doesn't wait for it, and `hook.run`'s `ms` is the background run's length, not time added
to the call. Rows still land within milliseconds of the call (the verifier saw 7 to 72 ms). SubagentStop is async too, because it waits for the subagent's transcript to settle: in a live run the hook read
the file 20 ms before the hand-back line was written, and lost the answer and the last message's tokens.
UserPromptSubmit, SubagentStart and Stop stay in line: with all of them async, a
headless `claude -p` session exited before its final Stop hook wrote `turn.usage`. A tool call made just before a
headless session exits can lose its row the same way; a thread's session stays up, so this is a headless-only edge.

**What it costs:** one background node process per tool call, and cost and the 5-hour and 7-day usage windows, which reach no hook. `turn.usage` carries them as
null with a placeholder. Reversible: a mod can replace the hook entry at any time.

**Where:** the entry and handlers sit in `scripts/` beside the other hooks, not in a `hooks/capture/` folder as the
item's output line named, because the env-bootstrap verifier's test reads every hook command as `scripts/<file>`.
