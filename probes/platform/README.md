# Platform probe

Throwaway probe for plan item `probe-platform-baseline`. It is not part of any plugin. The report it feeds is
`plan/research/platform-baseline.md`; the raw evidence is under `fixtures/`.

`hooks/register.ts` is a mod that acts on markers in a turn's text and logs one JSON line per result to
`out/probe-log.jsonl` (gitignored; copies of each run are under `fixtures/runs/`). Markers: `PROBE:spawn`,
`PROBE:cwd=<dir>`, `PROBE:mcp`, `PROBE:budget=<s>`, `PROBE:timer-spawn=<s>`. In a live thread it also spawns, and
runs the MCP probe once, on any queued-notifications turn (a send_later or GitHub PR event wake), because a wake's
own text never reaches `turn.start`. `scripts/slow-hook.sh` is a settings hook that sleeps `PROBE_SLOW_<Event>`
seconds and logs ticks, so a missing `end` line shows where it was killed.

Run each from the repo root. Every headless command needs only a container, not a platform wake.

| Probe | Command | Needs a platform wake |
|---|---|---|
| spawn, cwd, MCP (headless) | `claude -p "PROBE:spawn PROBE:cwd=/tmp PROBE:mcp . Wait for the subagents, then reply done." --plugin-dir probes/platform --permission-mode auto` | no |
| cwd, smallest repro | `mkdir -p /tmp/probe-cwd-target && claude -p "PROBE:cwd=/tmp/probe-cwd-target . Wait for the subagent, then reply done." --plugin-dir probes/platform --permission-mode auto`, then `grep '"label":"cwd"' probes/platform/out/probe-log.jsonl` (answer shows the parent's folder, not the target) | no |
| timer spawn and mod hook budget | `claude -p "PROBE:budget=15 PROBE:timer-spawn=5 . Then wait about 30 seconds for the subagent and reply done." --plugin-dir probes/platform --permission-mode auto` | no |
| settings hook budget, no timeout set | `PROBE_SLOW_SessionStart=70 PROBE_SLOW_PreToolUse=20 claude -p "Run the Bash command 'echo hi', then reply done." --plugin-dir probes/platform --permission-mode auto` | no |
| settings hook budget, timeout 5 | `claude -p "Run the Bash command 'echo hi', then reply done." --settings probes/platform/fixtures/runs/run-6-settings.json --permission-mode auto` (log goes to `/tmp/probe-timeout.jsonl`) | no |
| subagent depth | `claude -p "Use the Agent tool to start a subagent that uses the Agent tool to start one that replies nested-ok; report what happened, including whether the first subagent had an Agent tool." --settings '{"env":{"CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH":"1"}}' --permission-mode auto`, then the same with `"3"` and three levels. Pass the value with `--settings`: an `env` in `~/.claude/settings.json` overrides a shell variable (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 claude -p ...` still sees 3) | no |
| self-edit, working tree loaded | copy `probes/platform` into a temp git repo as `plugins/platform-probe`, then `claude -p "Append a comment line to plugins/platform-probe/hooks/register.ts and commit it." --plugin-dir plugins/platform-probe --permission-mode auto` | no |
| self-edit, released copy loaded | in a live thread with a released plugin loaded, commit a change to `plugins/<that plugin>/` on a scratch branch | no (a live thread) |
| idle spawn and idle merge, send_later wake | in a live thread with this mod loaded, schedule `send_later` (1 minute), end the turn; on the wake the mod spawns; have the model spawn with the Agent tool and merge a scratch PR | yes |
| idle spawn, PR event wake | in a live thread with this mod loaded, subscribe to a scratch PR and push or merge it; the event wake makes the mod spawn and run the MCP probe | yes |
| page reads a Library JSONL | publish `page/journal-read.html` with capabilities `{files: {project: "<project id>"}, db: {}}` after copying a JSONL to `probes/platform/probe-journal.jsonl` in the Library; open it as a project member | yes (a viewer) |

To load the mod in a live thread, write it under the session's mods folder (the plugin-authoring skill names it);
the person must answer "Turn on the mods" once. Under `claude -p`, `--plugin-dir` loads it with no question.
