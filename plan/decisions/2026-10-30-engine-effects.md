# How the engine's effects are built

**Date:** 2026-10-30
**Decided by:** the engine-effects thread (two-way doors; the person was away)

- **Merge is REST from the host's own process, with the MCP tool's arguments.** The GitHub MCP merge tool's
  `expectedHeadSha` is the REST merge call's `sha`, and a node process can't call an MCP tool, so
  `effects/merge.js` makes that REST call (`PUT /repos/{o}/{r}/pulls/{n}/merge`, `sha` = the verdict's sha,
  `merge_method` merge). GitHub answers 409 "Head branch was modified" when a commit landed after the verdict, and the
  PR stays open: seen on scratch PR #13 at about 20:12Z (refused at 41ea291, PR head c484188, then merged at c484188 by the
  same effect). No GraphQL (ledger L-graphql-blocked).
- **No shell, so the proxy tunnel is in code.** Node's fetch ignores `HTTPS_PROXY`; the journal check re-runs itself
  with `NODE_USE_ENV_PROXY`, which an effect can't (that is a child process). `effects/github.js` opens the CONNECT
  tunnel with `node:http` and `node:tls`. Repo-scoped calls work with the proxy's credentials.
- **A refused merge is `failed`, not `refused`.** `refused` is for a rule (auto mode, a hook). GitHub turning down a
  merge at an old head is the world disagreeing, so the effect fails with GitHub's message and the PR's real head,
  the actor's error event steps quick-fix to replanning, and the failure says why. A push normally reaches the item as
  `pr.pushed` first and sends it back to verifying; this is the backstop when it hasn't.
- **Crash mid-merge asks GitHub.** `find()` reads the PR: merged at the verified head ends the effect `done` without a
  second call; not merged lets it start again (GitHub refuses a wrong head anyway); merged at another head fails.
- **Effects are chosen by actor.** A workflow names the action by its invoked actor: `merge`, `ask` (card), `post`.
  The run handler says `handles(effect)` only for those, and `runEffects` now leaves a run its handler doesn't handle
  pending, so engine-actors can add `brief`, `build` and `verify` beside them.
- **Cards and posts go through a `hearth` client the caller supplies; none exists yet.** Only the session can call the
  thread's tools. So `bin/host.js` runs merges only, and cards, posts and timers stay pending and are printed. The
  session (engine-actors' return path, or engine-cards-standin) wires a client; until then nothing posts on its own.
- **Timers fire from wakes, as engine-host built.** The timer effect only asks a clock (`wakeAt`, `drop`) for the wake
  at the due time. `bin/host.js` has no clock, so it leaves timers pending. Running them there would also add rows on
  wakes that apply nothing, which engine-host's verifier tests rule out.
- **Red CI is a quick-fix event.** `github.check_run.completed` is taken in verifying and awaitingMerge when
  `redOnHead` holds (conclusion `failure` or `timed_out`, and `head_sha` is `context.pr.headSha`). With a build left
  the item goes to building with `failure` = `{ check, conclusion, sha, url }`, which the build's input now carries;
  with none, to replanning. A green check, or one on another head, is journalled refused. Guards gained one operator,
  `{ path, in: [...] }`. Replays of earlier journals are unchanged: context keeps the same fields.
- **Outside merges are listed, not just unexplained ones.** The journal check now also lists every merge with no host
  merge effect row (`engine.effect`, actor `merge`, phase `done`), even one a `pr.merge` capture row explains, as "not
  made by the host's merge effect (unverified)". `--host` makes them fail the check. The old `unexplained` list and
  exit code are unchanged, so obs-journal-vs-world's checks still hold.
- **The person's allow rule stays theirs.** The item's prereq ("the host merges a PR at the verified head after an
  independent PASS and green CI") is a settings change, so it is in waiting-for-person.md. A merge inside a hook's
  process is no tool call, so auto mode doesn't see it; the rule matters when a session runs `bin/host.js` by Bash.
- **engine-host's open gaps:** the ReadNotifications hook shape is still assumed (this thread runs release 0.1.0 from
  the cached snapshot, so its own calls aren't captured; see the s1 gate), and a GitHub field holding a literal
  `</event>` still cuts that event. Both stay open for the toy run, which runs live wakes.
