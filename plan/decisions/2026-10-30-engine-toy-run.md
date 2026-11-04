# How the toy run is run

**Date:** 2026-10-30
**Decided by:** the engine-toy-run thread (two-way doors; the person was away)

- **The driver is a headless session with the plugin from this repo.** This thread runs the cached 0.1.0 snapshot (see
  the s1 gate), whose plugin has no actor hooks and no capture, so its own calls can't be the toy run.
  `scripts/toy-run.sh run` starts `claude -p --plugin-dir plugins/harness --permission-mode auto` (Sonnet) with a
  journal of its own (`/mnt/project-files/toy-run/harness`), as engine-actors' verifier did. The driver files the
  item by Bash (`bin/host.js start`, whose source is its own session: filing is the session's act, as engine-host
  decided) and calls the Agent tool with `ccp-run <run>` for each run the harness names. The actor hooks do the
  rest. The cloud session id is unset for the child, so capture journals the driver as itself.
- **The host hook is added by `--settings`, not by the plugin.** The driver's UserPromptSubmit and
  ReadNotifications hooks run `bin/host.js wake` for its item, so a wake reaches the host with no agent in between.
  The plugin itself still runs no host: engine-host's verifier test (`verify/engine-host/plugin-tools.test.mjs`)
  stands unchanged, and wiring the host into the released plugin (which needs a way to find the session's items and
  XState in the installed copy) waits for the first real issue, which shows where the host has to run. So the
  installed plugin does not carry XState yet.
- **The thread puts the card up; the host waits for it.** A command can't reach the thread, and only the thread has
  cards. `bin/host.js show` lists the ask run under pending; the thread posts it with `request_decision` and records
  its id with `bin/host.js card` (`src/effects/relay.js`). The host's card effect waits (no rows) until that record
  exists, then finishes with the card id as its ref. The record says only which card was put up: an id that isn't the
  card the person tapped matches no tap. `wake` runs open effects before reading the wake, so the tap in the same
  wake finds its run.
- **The tap reaches the host as the driver's prompt.** `scripts/toy-run.sh tap` resumes the driver with the wake text
  exactly as the platform delivered it to this thread. The driver's host hook reads it as any wake: `decision-chosen`,
  its `decision_id` matched to the run by the recorded ref, source `hearth` and the card id. The thread copies the
  text, so it could in principle type one (engine-host's open gap, ledger L-same-account-everywhere); the verifier
  checks the decision id against the thread's own events.
- **The merge approval is the person's tap.** quick-fix asks the person before merging, and only a member's tap makes
  a `decision-chosen` wake; `close_decision` wakes nobody. So the toy run stops at the card until the person taps, and
  everything else (PR, verifier run) goes ahead meanwhile. This is the one step of the toy run nobody else can do; it
  is in waiting-for-person.md.
- **The toy issue is a new function per run** (`sub_<item>(a, b)` in the scratch repo's `src.js`, with a test), filed
  over REST (GraphQL is closed to cloud sessions, so the builder opens its PR with `gh api` too). Each run files its
  own issue, so the script is repeatable and the verifier reruns it from a fresh issue.
- **The first run (toy-1) was withdrawn.** The toy journal had no `sessions/` folder, which the install makes and
  capture doesn't, so the driver's calls weren't journalled. The script now makes it; toy-1's PR (#22) and issue (#21)
  were closed with a comment and its card withdrawn.
