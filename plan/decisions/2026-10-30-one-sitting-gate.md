# s0 one-sitting: judged 16:55Z, not passed

**Date:** 2026-10-30
**Decided by:** the one-sitting gate thread, at the coordinator's request (two-way door; the person was away)

The gate (`plan/stages/s0-environment.md`, id `one-sitting`): "Every allow rule and setting the thin path needs was
placed in one sitting with one rebuild". Its `how` is `plan/decisions/person-setup-sitting.md`.

## What the thread found

- **Allow rules.** `.claude/settings.json` on main holds the seven rules `plan/research/platform-baseline.md`
  ("Allow rules") calls the full v2 set, plus `$defaults`. They arrived in two commits: 8942a37 (a thread, 09:43Z,
  rules 1 to 3 and the setup stub) and a86614d (the person, in the GitHub web editor, 10:03Z, rules 4 to 7). Nothing
  has changed the file since.
- **Rules in force.** New containers at 11:35Z and 16:46Z ran `setup.sh` and had 8 rules and depth 3: the
  platform-baseline rerun, and the `session.fingerprint` rows of `session_01KfkB5JDoRrWsSin1udne7v` and
  `session_01KfkB5JWpsPCbEiHJb1AV9X` (`allow_rules` 8, `depth` 3). This thread's container resumed cached and skipped
  the script, but kept the 16:46Z `~/.claude/settings.json`, identical to the repo's rules.
- **Thin-path prereqs (s0 to s3) against the rules:** engine-actors (host spawns builder and verifier) is rule 5;
  engine-effects (host merges at the verified head after PASS and green CI) is rule 4; engine-toy-run's scratch
  repo exists and is attached; engine-host asks for "exact wording from the probe", and the probe reported nothing
  beyond the seven. clean-room-install-test's API-key secret is conditional and not placed.
- **Rebuilds.** The setup script was saved at least twice: once before 10:07Z (that thread's container resumed cached
  and skipped it) and again around 11:33Z so a new container would run it. The second save was needed because
  cached containers skip the script, not because a rule was missing.
- **Settings still to come.** engine-host ships as a plugin the person installs to the account when it is ready
  (`2026-10-30-setup-script-vs-sessionstart.md`), because mods a thread writes only load after the person turns
  them on per session. That is a setting the thin path needs and was not, and could not be, placed in the sitting.
- **The `how` file.** `person-setup-sitting.md` still says "Rules placed: none yet". It was written before the
  person placed the rules, by a stand-in, and records no sitting.

## Independent read

A Sonnet subagent with no conclusion handed to it read the same sources (settings history, env-manager log, journal
rows, stage and item files) and returned `VERDICT: FAIL`: rules placed and in force, but not in one sitting and not
with one rebuild, and the `how` file says no sitting took place. It counted the 16:46Z new containers as rebuilds;
they were new threads, not setup-script saves, so this record counts two saves, which doesn't change the verdict.

## The judgment

The gate `one-sitting` is **not passed**, and it cannot pass as written: the rules came in two pieces, the script
was saved twice, and one setting (the engine-host plugin install) can only be placed once engine-host exists.

What holds, and is what the gate was for (plan-review finding 7, L-attention-is-the-constraint,
L-rules-before-session): the full rule set is placed, it loads before sessions start in new containers, and no
thread has asked the person for a rule since 10:03Z.

## What happens next

- Nothing on the s0 to s3 path waits on this gate; items depend on items, not on stage gates.
- No person step makes this gate pass. The person steps the thin path still needs are already in
  `waiting-for-person.md`: install the engine-host plugin when it is ready. The product repo is s4.
- Recommendation for a later replan PR (not made here, so the gate isn't reworded by the thread that failed it):
  "Every allow rule the thin path needs is in force in a new container before the first build thread, and later
  asks are only for things that didn't exist at the sitting."
