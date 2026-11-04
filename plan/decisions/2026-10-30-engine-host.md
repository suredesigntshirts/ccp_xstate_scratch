# How the engine host is built

**Date:** 2026-10-30
**Decided by:** the engine-host thread (two-way doors; the person was away)

- **Ported from ccp_machine PR #110** (branch `claude/project-thread-3kdqwr` at 1dc495e, read with a plain clone):
  `host.js`'s refusals, run and timer tracking and effect mapping, and `driver.js`'s "journal before effects". Not
  ported: the driver's in-process actors and sessions port (engine-actors) and `step.js`'s parked sessions.
- **The host is a library plus a command, not a mod or a plugin tool.** Mods load only after the person turns them
  on for a session, which no thread can do (waiting-for-person.md), and a tool an agent calls is exactly what must not
  set an event's source. `bin/host.js wake` reads a Claude Code hook's input, so a thread's UserPromptSubmit hook (the
  wake as its prompt) or PostToolUse hook on ReadNotifications (PR events arrive there, in its result) can run it.
  Wiring it into the released plugin's hooks waits for engine-actors and engine-effects, which give it handlers; until
  then the plugin registers no tool and runs no host.
- **Sources come from the envelope or the host's own record.** GitHub: `github` and a hash of kind and JSON, so a
  redelivered event is a duplicate. A tap: `hearth` and the card id, accepted only for a card one of the item's runs
  made. A worker failure: the task id, only for a run that made that task. A timer: one the host set, fired once a
  wake's platform `current-time` passes its due time. The only exception is the start, whose source is the starting
  session: filing an item is that session's own act, not a claim about the world.
- **GitHub events reach a workflow as `github.<kind>` with the event's JSON**, and only if the workflow lists that
  type in `meta.events`. quick-fix lists none, so they are journalled `refused`; engine-effects maps red CI.
- **Effects are once by id, and a crash mid-effect asks the world.** A start row is written before the handler runs
  and an end row after. An effect with an end row is never run again. One with only a start row is looked up with
  its handler's `find()`; with none, it is journalled `unknown` and not repeated (at most once beats twice for a merge
  or a post). A refused effect ends `refused` with its rule and a refused or failed run sends its actor's error event,
  so quick-fix steps back to replanning with the refusal as `failure`.
- **One owner per item, by file.** The item's first row creates `items/<item>.jsonl` with an exclusive create; its
  session owns the item. Another session's event is journalled `not-owner` in that session's own file. If the
  mount hasn't shown the first row yet but the file exists, the item counts as owned by someone else.
- **Not observed live.** This thread's container resumed the 16:46Z snapshot with ccp-harness 0.1.0 (see the s1 gate,
  PR #39), so its own tool calls were not captured. The world proof (two sessions on the Library mount) runs headless.

## Round 2, after the verifier's NOT MET on no-agent-events

The verifier showed `bin/host.js wake` read a wake from any text on stdin: a Bash result holding a wake-shaped string
with a far-future `current-time` fired the build timer. Fixed at the root, in where wake text may come from:

- **Only the platform's envelopes.** `wake` reads a UserPromptSubmit prompt, or a ReadNotifications result's
  notifications whose `origin` is `github_webhook`, and nothing from any other tool. `wakesIn` reads only a `<wake>`
  that starts a line: the platform writes envelopes at column zero, and the harness indents a subagent's report, so
  a wake quoted inside agent text is not read.
- **A wake can't move the clock.** Its `current-time` is capped at the host's own clock, so no envelope makes a
  timer due early.
- **What stays open, on purpose:** an agent with a shell can still run `bin/host.js` with stdin it typed, just as it
  can append journal rows by hand. No tool or file the agent is given sets a source, but every agent acts as the same
  account with the same shell (ledger L-same-account-everywhere). The toy run's check that every transition's source
  is a wake, completion or timer, and the journal check against the world, are what catch a hand-typed one.
- **A refused source stays seen.** A GitHub event the workflow didn't take is the same fact if GitHub redelivers it,
  so the redelivery is a duplicate. A new fact (a new push, a new check run) has a new source.
- **quick-fix takes no GitHub event yet.** `pr.pushed` has no wake that makes it; engine-effects maps red CI and
  pushes to workflow events.
- `bin/host.js` prints a journal refusal (an older writer) as one line and exits 2.
