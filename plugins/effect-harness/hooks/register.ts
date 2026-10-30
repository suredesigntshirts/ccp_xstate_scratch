// The plugin's mod (hooks module). Claude Code loads this file directly and finds its hooks
// and mods API calls by static analysis, so: every `$` call is written out here in full,
// event names are string literals, and the logic it needs comes from the bundled
// ../dist/mod-lib.mjs as plain functions that take data, never `$`.
import { statusText } from "../dist/mod-lib.mjs"

export function register(on) {
  // Adds /harness when the session starts.
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "harness", description: "Show which effect-harness build this session runs" })
    return next(e)
  })

  // /harness: the plugin's name, version and folder.
  on("command.run", { command: "harness" }, async ($) => {
    const manifest = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)
    return { text: statusText(manifest, $.plugin.root) }
  })
}
// probe self-edit 2026-10-30: change to a plugin whose released copy this session has loaded
