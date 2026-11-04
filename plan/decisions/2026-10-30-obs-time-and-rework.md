# obs-time-and-rework: what the views count, and proving rework on this repo's PRs

**Date:** 2026-10-30, 18:50Z
**Decided by:** the obs-time-and-rework thread (two-way doors; the person was away)

## Why the rework line moved off ccp_machine

The item's `rework` line asked for ccp_machine PRs (#72 and two others). ccp_machine is public and a thread can clone
it, but the session's proxy refuses its GitHub REST (`api.github.com/repos/suredesigntshirts/ccp_machine/...` and the
web page both return 403, a policy denial), and check runs exist only in the API. Attaching ccp_machine to the session
would reach outside the two repos, which the project instructions treat as the person's call. ccp_xstate's own PRs
show the same failure the line is about: #14 went red seven times and #28 four. So a replan PR moved the line to this
repo's PRs, which is what the Verifier brief already said ("a real PR in this repo"), and #72 waits in
`waiting-for-person.md`.

## What the views count

- **Working** is any time a turn (a main-session wake to its Stop row), a tool call, a hook run or a subagent (spawn to
  finish) is in progress. Every other stretch is a gap, labelled by the main-session wake whose turn ends it:
  `mention`, `decision-chosen` and a typed `prompt` are the person; `external-event` is CI (GitHub); any other reason
  is a wake. A SessionStart inside a gap splits its tail off as `rebuild`. A gap no wake ends, one after a turn that
  never closed, or one whose wake has no reason, is `unknown`. Container boot before SessionStart writes no row, so it
  stays in the wake's wait.
- **A push** is a PR commit that CI ran on (it has check runs). A commit pushed together with a later one has none and
  isn't a push; a push that started no CI is invisible to this view.
- **A round** starts at a PR's first push and again at each push after a red one (any check run concluding failure,
  timed_out, action_required or startup_failure), except a merge commit, which stays in its round (as case
  C-merge-carry-pass treats a merge of main). All checks count by default; `--checks` narrows them. In this repo the
  verdict gate is red until the verifier commits, so a normal PR runs two rounds.
- **A replan** of a PR is another PR labelled `replan` that names the same item.
- **Overhead** splits a session's tokens (its `turn.usage` and `agent.finish` rows) by the share of changed lines, over
  the PRs it wrote commits on (`Claude-Session` trailers), in paths `packages/journal/harness-paths.json` lists. A
  session with no PR is unattributed. Rows hold no paths (capture keeps inputs as hashes), so PR files are the one
  place the harness/product line can be drawn without changing capture.
- **The tripwire** is one `tripwire` row per PR and limit, written by `derive.js rework --append`; the limit is the
  item's `step_back.max_rounds`, else 2.
