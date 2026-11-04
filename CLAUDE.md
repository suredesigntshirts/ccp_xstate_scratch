# ccp_xstate

The v2 harness, rebuilt on XState. This file is a map, not the manual: standing knowledge lives in `docs/` and
`plan/`, where it can be checked. Keep this file under 100 lines, and keep every path it names real.

## Principles

- **The verifier proves it, not the builder.** An item is done when a separate session shows its outcome holds
  (`plan/README.md`, "How slop is kept out").
- **The why travels with the work.** Every change names its plan item; the item's prose holds the reasoning.
- **A working small system first** (Gall's Law), end to end before wide, root cause over symptom.
- **Step back, don't grind.** An item's `step_back` caps its rounds; past that, replan instead of retrying.
- **Decide two-way doors and write them down** in `plan/decisions/`. One-way doors (settings, secrets,
  anything outside this repo and the scratch repo) go in `plan/decisions/waiting-for-person.md`.

## Branches and PRs

- Name a branch `<kind>/<item-id>`, where kind is the item's kind: `build/journal-schema`,
  `probe/probe-platform-baseline`. Other work uses `replan/<item-id>`, `docs/<topic>` or `chore/<topic>`.
  No `claude/` prefix.
- One plan item per PR. Put `Item: <item-id>` on its own line in the PR body.
- Every commit ends with a `Claude-Session:` trailer naming the session that wrote it.
- Merge into `main` only when `ci` and `verdict` are green at the head sha. See `docs/gates.md`.
- After merging a plugin change, release it: `node scripts/release/release.mjs branch --push` (`docs/gates.md`).

## Layout

| Path | What |
|---|---|
| `plan/` | The plan: items, stages, ledger, cases, decisions. Start at `plan/README.md` |
| `plan/check.mjs` | Checks the plan; `--order` prints build order |
| `packages/` | npm workspaces for the harness libraries; `packages/journal/` is the record format, `packages/engine/` loads and hosts workflows and runs their effects |
| `workflows/` | Workflow files as XState JSON; `workflows/quick-fix.json` is the first |
| `plugins/` | npm workspaces for the Claude Code plugins |
| `verify/<item>/` | The verifier's tests and `verdict.json` for each item |
| `scripts/gates/` | The PR gates CI runs |
| `test/` | Repo-wide tests, such as the workspace rules |
| `infra/cloud-environment/` | The cloud environment's setup script |
| `.github/workflows/` | `.github/workflows/ci.yml` and `.github/workflows/verdict.yml` |
| `docs/` | Standing knowledge; `docs/layout.md`, `docs/gates.md` and `docs/journal.md` |

## Commands

```
npm test                 # node:test over test/, scripts/, packages/, plugins/ and verify/
node plan/check.mjs      # the plan check; CI runs both on every PR
```

Node 22 or later. Zero runtime dependencies except `xstate`.
