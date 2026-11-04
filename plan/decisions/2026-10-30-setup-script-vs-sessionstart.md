# Setup script vs SessionStart hook for keeping the environment current

**Date:** 2026-10-30, by the probe-platform-baseline rerun thread, on the person's standing instruction to decide
two-way doors and not wait. The person asked (11:33Z): "keep it updated via sessionstart hook/mod as well (have you
looked into sessionstart vs setup?)".

**What was seen** (plan/research/platform-baseline.md, "Setup script vs SessionStart"):

- The setup script runs when a container is built. A thread resumed on a cached container skips it (10:07Z, 11:33Z).
  A new thread got a new container and the script ran (11:35Z, `session_mode: "new"`).
- A thread that tries to apply settings to itself is refused [Self-Modification] (11:34Z).
- Plugins synced to the account (harness-probe, effect-harness) load in every thread with their SessionStart hooks,
  with no question asked. Mods a thread writes need the person's "Turn on the mods" in each session.

**Choice:**

1. The setup script stays the one way settings arrive. Settings live in the repo's `.claude/settings.json`; the
   script merges them (infra/cloud-environment/setup.sh).
2. The v2 plugin gets a SessionStart hook that only checks: `~/.claude/settings.json` exists, holds the repo's
   `autoMode.allow` rules, and sets depth 3. When anything is missing it says so in the session's first context and
   records it, so a thread knows at once to label its results or ask for a new thread. Built by env-bootstrap.
3. When the setup script or the repo settings change, the remedy for running threads is to start new threads, not to
   patch settings from inside a session.
4. Whether the hook should also write the settings (taking effect from the next start or resume) is a settings
   change, so it stays on waiting-for-person.md.
5. Anything that must run in every thread without the person (engine-host) ships as an installed plugin, not a mod
   written in the session.

**Why:** the check costs nothing and closes the gap the first probe thread fell into (working without its rules and
not knowing). Writing settings from a hook is the self-modification the classifier refuses from a thread, and it
would land after the session read its settings anyway. Reversible: the hook is plugin code.
