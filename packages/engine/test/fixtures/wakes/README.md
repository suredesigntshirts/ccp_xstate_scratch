# Real wakes (plan item engine-host)

Each file is one wake as the platform delivered it, verbatim, read with claude-code-remote `list_events`.

- `check-run-failed.txt`, `check-suite-completed.txt`, `pr-merged.txt`: the three GitHub wakes the wf-quick-fix
  thread (session_01KfkB5HZRbfGRGcZb4ar2mX) received for ccp_xstate PR #27 on 2026-10-30, at 17:02:44Z, 18:06:40Z
  and 19:27:48Z. They reached the session as the body of a ReadNotifications result (origin `github_webhook`), not
  as its prompt: a PR event wakes the session with "notifications pending", and the session reads them.
- `tap-wake.txt`: a decision-chosen wake, copied from `plugins/harness/test/fixtures/attention/` (see its README).
