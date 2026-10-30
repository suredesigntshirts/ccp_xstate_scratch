# packages

One npm workspace per harness library, each with its own `package.json`. Runtime dependencies are limited to
`xstate` and sibling workspaces (`test/workspaces.test.mjs` holds this). See `docs/layout.md`.
