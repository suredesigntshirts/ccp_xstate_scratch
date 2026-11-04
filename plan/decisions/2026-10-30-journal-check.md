# The journal check reads saved event logs, and a merge is journalled by a pr.merge row from capture

**Date:** 2026-10-30, by the obs-journal-vs-world thread, on the person's standing instruction to decide two-way
doors and not wait.

**Event log as a file.** The item names `list_events` as the session's own record. That is an MCP tool, which a
command can't call, so `journal-check.js --events` reads `list_events` pages a session saved, or a Claude Code
transcript, which holds the same tool_use and tool_result blocks (and its `subagents/` folder holds the subagents').
Both shapes give the same calls (`packages/journal/test/check.test.js`).

**Calls no hook sees aren't counted missing.** A call Claude Code answers without running (a `<tool_use_error>`
result, such as a blocked `sleep`) fires no hook (seen by the obs-live-capture verifier), so no capture can journal
it. The report shows these, and calls with no result yet, but leaves them out of "missing" and of the exit code.

**What journals a merge.** Nothing recorded merges before this item, and tool.call rows keep only a hash of the
input, so the check couldn't tell a journalled merge from any other. Capture now writes a `pr.merge` row when the
GitHub MCP merge tool's own response says merged: `owner/repo#number` and GitHub's merge sha, the one place capture
keeps tool-input identifiers. A merge through the REST API, the web UI or `git push` has no such row and is listed
(case C-merge-outside-host-detected). When engine-effects builds the host's merge effect, it can narrow "journalled"
to its own rows. Reversible: the rule lives in `checkMerges()`.

**GitHub through the proxy.** Node's fetch ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY` is set, and the cloud
session reaches api.github.com only through its proxy (403 without it, 200 with it, 2026-10-30), so the command runs
itself again with it set. Repo-scoped REST reads work with the proxy's credentials; no token is needed.

**Where the check row goes.** `--record <file>` appends the `journal.check` row to the file the caller names,
usually its own session file, so one writer per file holds.

**What a real session in the v2 project can show today.** Thread sessions still run release 0.1.0, which has no
capture (their self-check says so), so their journals have no tool.call rows and the check lists every call as
missing; that is a true report. A captured real session needs a thread on 0.1.3 or later, or a headless
`claude -p --plugin-dir plugins/harness` session, as obs-live-capture's verifier used.
