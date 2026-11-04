# Cloud environment

1. In the v2 project: Project settings, Cloud environment menu, create an environment of its own (not v1's).
2. Click the gear beside it and paste `paste-me.sh` into Setup script, once. Saving rebuilds the container.
3. Allow rules and settings live in `.claude/settings.json` at the repo root. `setup.sh` merges them into
   `~/.claude/settings.json` at each container build. A change reaches threads only after a rebuild (re-save the
   setup script), and only rules placed before a thread starts count (ledger L-rules-before-session).
4. `setup.sh` also installs the ccp-harness plugin as a copy of its newest release (`plugins/harness/README.md`)
   and logs environment variable names, never values. First it fast-forwards the clone to `origin/main` when the
   clone is clean and on `main` (or detached at an ancestor of it), and logs why when it doesn't. Log: `/tmp/ccp-xstate-setup.log`.

A thread resumed on a cached container skips the setup script. The plugin's SessionStart self-check says so in the
session's first context when settings, rules or depth are missing; start a new thread to get a fresh container.
