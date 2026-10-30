# ccp_xstate_scratch

A throwaway repo for ccp_xstate's platform probes and toy runs: scratch PRs, deliberate CI failures, merges on idle
wakes. Nothing here matters; anything may be merged, reverted or rewritten by the v2 harness. Real work never lives
here. The plan that uses it is in suredesigntshirts/ccp_xstate, `plan/`.

- `npm test` runs `node --test`. CI runs it on every PR and push to main.
- To make CI red on purpose, add a failing test in a PR (see `test/README.md`).
verify non-plugin 1793362785
