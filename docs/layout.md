# Repo layout

```
package.json        npm workspaces (packages/*, plugins/*); Node 22+; `npm test` runs everything
packages/<name>/    a harness library: package.json, src/, test/
plugins/<name>/     a Claude Code plugin: package.json, .claude-plugin/plugin.json, and its parts
workflows/          workflow files: XState machine config as JSON, loaded by packages/engine
verify/<item>/      the verifier's own tests for an item, and its verdict.json
scripts/gates/      the PR gates verdict.yml runs, with their tests
test/               repo-wide tests
plan/               the plan (plan/README.md)
docs/               standing knowledge, one file per subject
```

## Tests

Tests use `node:test` and `node:assert`, nothing else. Name them `*.test.js` or `*.test.mjs`. `npm test` runs
every test under `test/`, `scripts/`, `packages/`, `plugins/` and `verify/`, so a workspace needs no test script
of its own to be covered by CI.

## Dependencies

No runtime dependency except `xstate` and sibling workspaces. `test/workspaces.test.mjs` fails a
`package.json` that adds one. Dev tooling stays at what Node ships. `xstate` is pinned to an exact version in each `package.json` and in
`package-lock.json`; CI installs it with `npm ci`.
