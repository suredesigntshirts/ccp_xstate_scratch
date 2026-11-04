# The self-check

Every session in a project that installed the harness starts with a self-check (`plugins/harness/scripts/selfcheck.mjs`,
run by the SessionStart hook). It journals a `session.selfcheck` row (`docs/journal.md`) and tells the session one
line: `ccp-harness <version>: self-check passed (n of m checks).`, or `self-check FAILED.` and one sentence per
failed check. An `unknown` check (origin unreachable, no release yet) does not fail it.

| Check | Fails when |
|---|---|
| `settings` | `~/.claude/settings.json` is missing: the setup script did not run in this container |
| `rules` | some of the repo's `autoMode.allow` rules are not in `~/.claude/settings.json` |
| `depth` | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is not 3 |
| `files` | a file the plugin needs is missing (named, with what needs it) |
| `copy` | the plugin runs from the repo or a link, not an installed release copy |
| `release` | a newer `harness-v*` release is out |
| `journal` | the session's journal file could not be written |

## Reading a clean-room failure

The `clean-room` workflow (`.github/workflows/clean-room.yml`) runs `scripts/clean-room/run.mjs`: an empty HOME and
an empty project folder, the setup script, the install, one session, and the self-check must pass. Run it locally
with `node scripts/clean-room/run.mjs --ref HEAD --session hooks` (add `--keep` to look at the room afterwards). The
job summary and log hold a report: the session mode, the self-check line, and one line per step. Read the first
step marked `FAILED`:

- **empty**: the temp folders were not empty. Something outside the job wrote into them; rerun.
- **setup**: the setup script did not install the plugin. The step quotes the setup log's `plugin` line, or says
  none was written; the cause is in `infra/cloud-environment/setup.sh` or in the ref it installed (could not
  extract `plugins/harness`).
- **install**: `scripts/install.mjs` failed; its line says why.
- **session**: the session never ran the plugin's hook. With `claude -p`, either Claude Code ran no SessionStart
  hook (auth or startup failed; the step quotes its stderr) or it ran others but not ccp-harness's (the plugin did
  not load: look at `.claude-plugin/plugin.json` and `hooks/hooks.json`). Without a model, either `hooks/hooks.json`
  could not be read or a hook command exited non-zero (its stderr is quoted).
- **selfcheck**: the hook ran and the self-check failed. The quoted line names each failed check in one sentence.
  In a clean room, `files` is the one to expect: `The plugin at <root> is missing <file> (needed by <file>)` means
  a file was deleted or left out of the release (`setup.sh` copies `plugins/harness` and `packages/journal`, minus
  their tests). `settings`, `rules` or `depth` failing means the setup script's settings merge broke; `copy` means
  the install linked or ran from the repo; `release` means the installed copy is older than the newest release.
  When the hook's own modules are missing it says `could not run` and journals nothing, so **journal** fails too.
- **journal**: the session file lacks the fingerprint or a passing self-check row.

A release run (`release/harness-v*` push, `harness-v*` tag, or run by hand) installs the newest release, not the
commit that triggered it, exactly as a container build does. A PR run installs the PR's merge commit.
