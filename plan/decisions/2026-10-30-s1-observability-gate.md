# s1 observability: judged 19:30Z, not passed

**Date:** 2026-10-30
**Decided by:** the s1/s2 gate thread, at the coordinator's request (two-way door; the person was away)

Stage s1's six items are all done (obs-page merged as #38, release harness-v0.1.9), so its gate is due. The gate
(`plan/stages/s1-observability.md`) has three checks: `live-journal`, `person-rows` and `answers`.

## What the thread found

**No thread in this project has ever run a release with capture.** Every `session.fingerprint` row in
`/mnt/project-files/harness/journal/sessions/` (16 files, 20 fingerprints, the last at 19:24Z from this thread) names
ccp-harness 0.1.0. The journal holds only `session.fingerprint`, `session.selfcheck` and `ci.result` rows: no
`tool.call`, no `person.message`, no `person.tap`. Capture first shipped in harness-v0.1.3 (obs-live-capture, #28);
person rows in the release after obs-person-attention (#30); the newest release is 0.1.9.

The cause is the container cache, not the plugin. This thread's `/tmp/env-manager.log` says `session_mode:
resume-cached` and "Skipping initialization script for faster startup". `~/.claude/skills/ccp-harness/release.json`
says 0.1.0, written at 16:46Z: the snapshot new threads resume was taken when 0.1.0 was the newest release, and
`infra/cloud-environment/setup.sh`, the only thing that installs a newer one, does not run on a cached resume. The
plugin's own behind-notice fires correctly ("0.1.9 is out ... a new thread will load the newer release"), but the
new thread resumes the same snapshot, so the promise in that notice does not hold today.

Every s1 item's world proof was therefore made on a headless `claude -p --plugin-dir plugins/harness` session in a
thread's container (obs-live-capture, obs-journal-vs-world `session-diff`) or by replaying a real thread's recorded
wakes through the real hook (obs-person-attention `rows-real`). Those prove the code. They do not prove a live
thread journals itself, and each item put that live check in `after_landing` for this gate.

| Check | Result | Why |
|---|---|---|
| `live-journal` | **not met** | No thread runs capture. On a headless session in this project's container the check reports 0 missing of 5 calls (obs-journal-vs-world verdict), but the gate asks for a real session's own log, and against a real thread (0.1.0) it reports 60 of 61 calls missing, which is true. |
| `person-rows` | **not met** | No thread has run "the release that carries obs-person-attention". The replay proof (6 messages and 1 tap read with `read_thread` equal the 6 + 1 rows the hook makes from that thread's wakes) is the strongest a thread can make without it. |
| `answers` | **not met** | Only the person can read the observe page (https://claude.ai/artifact/GEVcccpqcToRUb7EhTG4B3) and name a missing answer. No reply is recorded. With no capture rows, the page has little to show yet. |

## Independent read

A Sonnet subagent, given the sources and no conclusion, counted the journal rows, read the env-manager log, the
installed `release.json`, the release refs and the four s1 verdicts, and returned `s1: FAIL` with the same three
checks not met.

## Routes tried or weighed

- Run `setup.sh` from this session: it refuses by design while Claude Code runs from this HOME, and even if it
  installed, the next thread resumes the 16:46Z snapshot, not this container.
- Put the capture hooks in `~/.claude/settings.json` or the repo's `.claude/settings.json`: a settings change, which
  the allow rules leave to the person (and `~/.claude` writes were refused as self-modification at 11:34Z).
- Count a headless session as the gate's "real session": that is the item proofs over again and would hide the one
  fact this gate exists to surface.

None is a thread step. One person step fixes the first two checks: re-save the environment's setup script (any
change, even a comment) so the next thread gets a new container, runs `setup.sh` and installs harness-v0.1.9. It is in
`waiting-for-person.md`.

## The judgment

Stage s1 is **not passed**. The code for every check is built and verified; what is missing is a live thread running
it, which waits on one environment re-save, and the person's read of the page.

## What happens next

- Items depend on items, not on stage gates, so engine-host is next and starts now. Its threads run 0.1.0 until the
  re-save, so s1's goal "the engine is built under this observation from its first commit" will not hold for its
  first commits. Its verifier can still read a headless session's capture, as the s1 verifiers did.
- After the re-save, the first new thread whose fingerprint says 0.1.9 (or newer) is the gate's test session. A
  separate session then reruns this judgment: `journal-check.js --journal <its journal> --events <its transcript>`
  for `live-journal`, and `read_thread` against its `person.*` rows for `person-rows`.
- The self-check already fails on every such thread (`release`: "This session runs release 0.1.0 but 0.1.9 is out
  ... a new thread will load the newer release"). Recommendation for a later replan (not made here): when the
  installed copy is older than the newest release and the container resumed cached, say that a setup-script re-save
  is what loads it, since a new thread alone does not.
