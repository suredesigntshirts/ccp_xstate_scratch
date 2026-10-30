# The journal

Every record the harness keeps is a journal row: one JSON object per line in an append-only `.jsonl` file. The
format is `packages/journal/schema/row.schema.json`; the library is `packages/journal/src/`. Plan item
`journal-schema` holds the reasoning.

Only external inputs and observations become rows: tool calls, completions, wakes, taps, CI results. Nothing an
agent says about itself is journalled (ledger L-agents-self-report).

## A row

| Field | Required | What |
|---|---|---|
| `v` | yes | The row format version, an integer from 1. `append()` stamps it |
| `id` | yes | Unique row id. `append()` makes a UUID when none is given. An effect's outcome is keyed by it |
| `at` | yes | ISO 8601 UTC time with milliseconds. `append()` stamps it when none is given |
| `kind` | yes | What the row records, from the list below |
| `source` | yes | `{ system, ref }`: the system that reported the fact and its own id for it, recorded at write time |
| `session` | yes | The `Claude-Session` that wrote the row |
| `agent` | no | The subagent within the session, or null |
| `item` | no | The plan item the row belongs to, or null |
| `state` | no | The item's or workflow's state when written, or null |
| `release` | yes | The writer's harness release, `x.y.z` |
| `placeholder` | no | The reason, on a row that stands in for missing data, so health checks count it (L-placeholders-labelled) |
| `payload` | yes | The kind's own fields, an object |

## Files and writers

- **One writer per file.** A file belongs to one session (`<session>.jsonl`) or to one item, owned by the thread
  working it. The mount has no locks (L-library-mount-slow), so ownership is what keeps writes apart.
- **Append only.** `append(path, row)` opens that one file in append mode, writes the whole line in one write and
  closes it. It never lists a folder and never creates one; the caller makes the folder once. A line is capped at
  1 MiB so it goes out in one write.
- **Older writers are refused.** Before writing, `append()` reads the file's tail for the last row's release. If the
  writer's release is older, it throws `OlderWriterError` naming both (L-older-writer-refused). Because older
  writers are refused, the last row carries the newest release. Two writers racing on their first rows can slip
  past this; one writer per file is what rules that out.
- **Reading.** `readFile(path)` reads one known file and returns `{ rows, bad }`: rows upcast to the reader's
  version and sorted by `at`, and every line it couldn't use with its line number and reason (a torn line, no `v`,
  a newer `v`, a schema failure). Nothing is dropped silently, and reading never writes.
  `readAll(root)` reads every `.jsonl` under a folder and merges them by `at`. It lists folders, so it is for
  offline tools only, never a hook or any hot path.

## Versions

`v` changes only when a row's shape changes in a way an old reader would misread. Adding a kind or an optional
field doesn't need a bump. On a bump, add an upcaster to `UPCASTERS` in `src/index.js`, keyed by the old version,
that turns a row of `v` n into `v` n + 1. Old rows are upcast on read and never rewritten (L-version-event-schema).
A reader marks a row from a newer `v` as bad rather than guessing. There are no upcasters yet.

`release` is separate from `v`: it says which build of the harness wrote the row, so a stale checkout can't write
after a newer one.

## Kinds

| Kind | Records | `source.system`, `source.ref` |
|---|---|---|
| `session.fingerprint` | A session's start: model, plugins, environment, cwd | `claude-code`, the session id |
| `session.selfcheck` | The start-of-session self-check: each check and whether it passed | `hook`, `SessionStart <session id>` |
| `tool.call` | One tool call and its completion | `claude-code`, the tool use id |
| `agent.spawn` | A subagent started | `claude-code`, the spawning tool use id |
| `agent.finish` | A subagent finished, with its result size and status | `claude-code`, the spawning tool use id |
| `turn.usage` | Tokens and time for one turn | `claude-code`, the message id |
| `refusal` | A refused call, permission, push or gate, with the text | the refusing system, its id for the call |
| `hook.run` | A hook ran: event, duration, outcome | `hook`, the hook event and call id |
| `person.message` | The person wrote in a thread or chat | `hearth`, the message id |
| `person.tap` | The person tapped a card option | `hearth`, the card's message id |
| `card.posted` | A decision or draft card was posted | `hearth`, the card's message id |
| `brief.stored` | A brief handed to a session or subagent was stored | the store, the brief's path or id |
| `result.stored` | A session's or subagent's result was stored | the store, the result's path or id |
| `ci.result` | A CI run finished on a sha | `github`, the run id |
| `page.refresh` | A page was published or refreshed | `artifact`, the page url |

Payload fields per kind are set by the item that first writes that kind (the two `session.*` kinds are below); the envelope above is what every reader
can rely on. Engine transitions arrive in stage 3 as `engine.transition`, with the transition id and the causing
call or completion id recorded at write time (L-record-route-at-write).

## Session rows

The harness plugin's SessionStart hook (plan item env-bootstrap, `plugins/harness/README.md`) writes both, in that
order, to `sessions/<session>.jsonl` under the journal root, in a project that installed the harness.

`session.fingerprint` payload: `claude_code` (from `claude --version`), `model` (null: SessionStart's input doesn't
carry it; the served model arrives with turn rows), `start` (`startup`, `resume`, ...), `cwd`, `plugin`
(`name`, `version`, `tag`, `commit`, `root` of the running copy), `latest_release` (the newest `harness-v*` tag's
version on origin, or `none` or `unknown`), `settings` (`present`, `missing` or `unreadable (...)`), `allow_rules`
(how many), `rules_hash` (16 hex of a sha256 over the sorted rules), `depth` (the subagent depth setting),
`plugins` (skills-dir plugins: `name`, `version`, `from`) and `environment` (`remote`, `entrypoint`, `container`).

`session.selfcheck` payload: `passed` (false when any check failed) and `checks`, a list of `{ id, status, detail }`
with status `pass`, `fail` or `unknown`. An unknown doesn't fail the check. A failure's `detail` is one plain
sentence saying what is wrong and what to do. The ids: `settings`, `rules`, `depth`, `copy`, `release`, `journal`.

## Release rows

`scripts/release/release.mjs` (plan item self-update-by-version) makes one `ci.result` row per release run. From a
thread, `source` is `git` and the release branch (or the sha when nothing was released) and `session` the thread's
Claude-Session; the thread journals it. From `.github/workflows/release.yml`, `source` is `github` and the run id,
`session` the run's URL, and the row is in the tag's annotation and the run's summary. `payload`: `workflow` (`release`), `sha`, `result` (`released` or `skipped`), `reason`, `tag`, `version`,
`previous` (the newest release before it, or null) and `changed` (the released files that changed).

## Adding a kind

1. Add it to `KINDS` in `packages/journal/src/kinds.js` (dotted lower-case words). `append()` refuses kinds not on
   the list; readers accept any well-formed kind, so older readers still read the new rows.
2. Add a row to the table above saying what it records and what its `source` is.
3. Add the kind's payload fields to the item that writes it, with a test that a row of the kind validates.
