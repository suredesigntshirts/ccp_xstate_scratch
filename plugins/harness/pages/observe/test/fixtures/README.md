# Observe page fixtures (plan item obs-page)

`rows.jsonl` is made by `make.mjs` from recorded inputs only, each row at its real time:

- session `059f9a1c-…`: obs-time-and-rework's real headless session with a subagent, as its capture wrote it
  (`packages/journal/test/fixtures/derive/session.jsonl`).
- session `session_01KfkB5HZRbfGRGcZb4ar2mX` (the wf-quick-fix thread): the card it posted at 16:29:24Z, the person's
  tap on it at 16:54:27Z and their message at 16:54:30Z, through capture's `posted` and `personOf` from
  `plugins/harness/test/fixtures/attention/`.
- session `eb589e54-…`: the auto mode classifier's `[Self-Modification]` refusal at 11:34:29Z, through capture's
  `PermissionDenied` handler from `probes/platform/fixtures/refusals/`.
