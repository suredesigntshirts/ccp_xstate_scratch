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
| `refusal` | A refused call, permission, push or gate, with its rule and a hash of its text | the refusing system, its id for the call |
| `hook.run` | A hook ran: event, duration, outcome | `hook`, the hook event and call id |
| `person.message` | The person wrote in a thread or chat | `hearth`, the message id |
| `person.tap` | The person tapped a card option | `hearth`, the card's message id |
| `card.posted` | A decision or draft card was posted | `hearth`, the card's message id |
| `post.sent` | The session posted a message to the person in a thread | `hearth`, the message id |
| `brief.stored` | A brief handed to a session or subagent was stored | the store, the brief's path or id |
| `result.stored` | A session's or subagent's result was stored | the store, the result's path or id |
| `ci.result` | A CI run finished on a sha | `github`, the run id |
| `page.refresh` | A page was published or refreshed | `artifact`, the page url |
| `wake` | Something started a turn: a hearth wake, a subagent's report, a task notification or a typed prompt | `claude-code`, the prompt id |
| `pr.merge` | A PR merged by a journalled merge, as the merge's own response reports it | `github`, `owner/repo#number` |
| `journal.check` | The journal check ran: what it compared and the counts it found | `journal-check`, the inputs it compared |
| `tripwire` | A PR passed its round limit | `github`, `<owner/repo>#<pr>` |
| `engine.transition` | An event offered to an item's workflow, and whether the host applied it | the event's source: `github`, `hearth`, `claude-code`, `timer` or `engine`, and its id there |
| `engine.effect` | A host effect starting or ending | `engine`, the effect id |

Payload fields per kind are set by the item that first writes that kind (the two `session.*` kinds are below); the envelope above is what every reader
can rely on.

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

## Capture rows

The harness plugin's capture hook (plan item obs-live-capture, `plugins/harness/scripts/capture.mjs`) writes these to the
session's file as they happen, in a project that installed the harness. Every row's `agent` is the subagent it is
about, or null for the main session. No row holds what a tool was given or what anyone wrote: inputs are kept as a
sha256 and a size. The only text kept is a subagent's brief and final answer, each stored once as
`<journal root>/blobs/<sha256>` and linked by hash.

| Hook | Kind | `payload` |
|---|---|---|
| PostToolUse, PostToolUseFailure | `tool.call` | `tool`, `inputHash` (sha256 of the input's JSON), `inputBytes`, `ms` (Claude Code's `duration_ms`), `ok` (false from PostToolUseFailure) |
| SubagentStart | `agent.spawn` | `agentId`, `type`, `model` (null: the start doesn't say; `agent.finish` has the served one), `briefHash` (null with a placeholder when a background agent's transcript is not written yet), `depth` |
| PostToolUse of the GitHub MCP merge tool (`mcp__*github*__merge_pull_request`), when its response says merged | `pr.merge` | `repo` (`owner/name`), `number`, `sha` (the merge commit GitHub returned, or null), `tool`, `toolUseId`. These identifiers are the one exception to keeping no tool input |
| PostToolUse of the Agent tool | `brief.stored` | `agentId` (from the call's result), `hash`, `bytes` of the prompt it was given; `source.ref` is `blobs/<hash>` |
| SubagentStop | `agent.finish` | `agentId`, `type`, `model`, `ms` (first to last line of its transcript), `tokens` (`input`, `output`, `cacheRead`, `cacheCreation`, summed over its messages), `resultHash` |
| SubagentStop | `result.stored` | `agentId`, `hash`, `bytes`: its SubagentHandback message, else its last text |
| UserPromptSubmit | `wake` | `reason` (the hearth wake's reason, `agent-message`, `task-notification` or `prompt`), `source` (`hearth`, `subagent`, `claude-code` or `user`), `hash`, `bytes` |
| Stop | `turn.usage` | `tokens` (as above, for the main transcript's messages since the last Stop), `messages`, `models`, and `cost`, `fiveHour`, `sevenDay` as null with a `placeholder`: no hook receives them |
| each of the above | `hook.run` | `name` (`capture <event>`), `ms` (since the hook's process started; on tool calls capture runs async, so there this is not time added to the call), `timedOut` |

`agent.spawn` and `agent.finish` take `source.ref` from the spawning tool use id in the subagent's `meta.json`. The
brief is the first line of the subagent's transcript; the Agent call returns it too, which is where `brief.stored` comes from.

## Person rows

The capture hook (plan item obs-person-attention, `plugins/harness/scripts/capture-rows.mjs`, `personOf` and
`posted`) writes these alongside the capture rows. What the person did arrives as a hearth wake, read at
UserPromptSubmit; what the session put in front of them is its own hearthbot tool call, read at PostToolUse. No row
holds what anyone wrote: text is kept as a sha256 and a size.

| Hook | Kind | `payload` |
|---|---|---|
| UserPromptSubmit | `person.message` | `thread` (the wake's thread ts), `messageId`, `reason` (the wake's reason, such as `mention`), `trigger`, `surface`, `sentAt` (the platform's time), `authorId`, `hash`, `bytes`. One per `from="human"` message in the wake; a message with no id gets a placeholder |
| UserPromptSubmit | `person.tap` | `thread`, `cardId` (the wake's `decision_id` note), `option` (`A`, `B`, ...), `optionIndex`, `sentAt`, `authorId`. A `decision-chosen` wake makes this instead of a `person.message`; `source.ref` is the card id |
| PostToolUse of `request_decision` or `post_widget` | `card.posted` | `thread`, `cardId` (the call's `message_id`), `card` (`decision` or `widget`), `options` (how many), `recommended`, `inputHash`, `inputBytes` |
| PostToolUse of `post_message` | `post.sent` | `thread` (the call's `thread_id`), `messageId`, `hash`, `bytes` of the text, `attached` (how many outputs) |

A card's thread is the thread of the last wake the session saw, kept in capture's state file, since
`request_decision` returns only the card id. Messages a coordinator relays (`<cited author="user">`) are copies and
make no row. What this misses: the person's messages in the project chat reach the coordinator, which runs no hooks;
a card a mod posts through `$.mcp.call` is no tool call, so it has no `card.posted` (its tap still has a row); and
checklist updates and reactions the session makes are not posts.

`packages/journal/src/derive/attention.js` reads these rows into the attention view: per UTC day and per thread the
person's messages and taps, the cards and posts, open cards and card waits (tap `sentAt` minus the card row's `at`),
each card with its post, tap and wait, and posts (posts and cards) per thread-hour and project-hour, flagged over
the caps of 20 per thread and 60 per project (ledger L-message-caps). A message seen on two wakes counts once by its id.

## The journal check

`packages/journal/bin/journal-check.js` (plan item obs-journal-vs-world) compares the journal with facts from
outside it and lists what doesn't match (ledger L-checks-against-world). It reads and never repairs: a gap stays a
gap until a separate, explicit command writes a labelled placeholder row.

```
node packages/journal/bin/journal-check.js --journal <session file> --events <event log>
node packages/journal/bin/journal-check.js --journal <journal root> --repo <owner/name> [--since <ISO time>]
```

- **Session diff** (`--events`, with `--session <file>` when `--journal` is the root). The event log is the
  session's own record of its tool calls: `list_events` pages saved as JSON or JSONL, or a Claude Code transcript
  (its `subagents/` folder is read too). It lists every call that ran with no `tool.call` row, and every
  `tool.call` row inside the log's time span whose tool use id the log doesn't have. Calls Claude Code answered
  without running (a `<tool_use_error>` result, such as a blocked `sleep`) and calls with no result yet are shown
  but not counted: no hook fires for them. `list_events` is an MCP tool, so the session saves its pages to a file
  first; a cloud session's local transcript is under `~/.claude/projects/`.
- **Merge diff** (`--repo`, repeatable). It asks GitHub's REST API for the repo's closed PRs (through the session's
  proxy, which Node needs `NODE_USE_ENV_PROXY` for; the command sets it) or reads saved responses with `--prs`. It
  lists every PR merged since `--since` (default: the journal's first row) with no `pr.merge` row naming it, with
  its head and merge shas, and every `pr.merge` row GitHub shows unmerged or merged at another sha. A merge made
  through the REST API, the web UI or `git push` has no `pr.merge` row, so it is listed (case
  C-merge-outside-host-detected). A merge with the GitHub MCP merge tool in a session that captures counts as
  journalled, but every merge the host's merge effect didn't make (an `engine.effect` row, actor `merge`, phase
  `done`) is also listed as not made by the host, and `--host` fails on it (plan item engine-effects).
- `--record <file>` appends a `journal.check` row: `payload` has `ok`, `since`, `journal`, the counts (`calls`,
  `callRows`, `missing`, `notRun`, `pending`, `unfoundCalls`, `outside`, `merges`, `mergeRows`, `hostMerges`,
  `unexplained`, `outsideHost`, `unfoundMerges`) and `badLines`, the journal lines it couldn't read.
- Exit 0 when nothing is listed, 1 when something is, 2 when it couldn't run. `--json` prints the whole result.

`list_events` retention is unknown, so run the session diff soon after a session ends.

## Refusal rows

The capture hook (plan item obs-refusal-log) writes a `refusal` row to the session's file for every refused call. How
each refusal reaches it (probed 2026-10-30, Claude Code 2.1.314):

- **Auto mode classifier:** the PermissionDenied hook fires, with the tool, its input and `reason`, the rule as the
  classifier names it, such as `[Self-Modification]`. The full text the model saw doesn't reach the hook. Captured live.
- **A hook's denial** (PreToolUse `permissionDecision: deny`, or a blocking exit) and **a permission rule's denial**
  fire no hook: the call never runs, so neither PostToolUse, PostToolUseFailure nor PermissionDenied sees it. The model
  gets an error tool_result, `PreToolUse:<tool> hook error: <reason>` or `Permission to use <tool> with ... has been
  denied.`, so the Stop and SubagentStop handlers find these in the transcript they already read, at the end of the
  turn or the agent. A person declining a prompt (`The user doesn't want to proceed ...`) counts as a permission
  refusal the same way.

`source` is `{ system, ref }`: `hook` for a hook's denial, else `claude-code`, and the refused tool use id. `at` is the
refusal's own time, from the transcript for the ones found there. `agent` is the subagent whose call was refused, or
null. `payload`:

| Field | What |
|---|---|
| source | `classifier`, `hook` or `permission` |
| rule | The classifier's `reason`; for a hook, the name its reason starts with (`<rule>: why`, as our hooks write them), else `<event> hook`; for a permission, `deny rule` or `person declined` |
| textHash | sha256 of the refusal text the model saw, or null for a classifier refusal (its text doesn't reach the hook). The text itself is never kept: a permission denial's text holds the command, and a hook's may |
| actionHash | sha256 of the tool name and its input, without a top-level `description` (the model's label, reworded freely). Two calls of the same action share it |
| tool | The refused tool's name |
| retryOf | The id of the latest earlier refusal in this session with the same `actionHash`, or null |
| outcome | `denied`: the refused call did not run |

A row is never changed after it is written, so whether a refusal was retried and how that ended is read forward: a
later `refusal` whose `retryOf` is this row's id was refused again; a later `tool.call` whose `payload.retryOf` is this
row's id ran (`ok` says whether it succeeded). `tool.call` carries `retryOf` only when its action had been refused
before. A hook or permission refusal is journalled only at the turn's end, so a call that runs later in that same turn
doesn't link to it; a classifier refusal links at once. The session's refusals so far (`actionHash` to row id) are
kept in `$CCP_HARNESS_STATE/refusals-<session>.jsonl`, append-only, so each hook run can link without reading the
journal.

## Release rows

`scripts/release/release.mjs` (plan item self-update-by-version) makes one `ci.result` row per release run. From a
thread, `source` is `git` and the release branch (or the sha when nothing was released) and `session` the thread's
Claude-Session; the thread journals it. From `.github/workflows/release.yml`, `source` is `github` and the run id,
`session` the run's URL, and the row is in the tag's annotation and the run's summary. `payload`: `workflow` (`release`), `sha`, `result` (`released` or `skipped`), `reason`, `tag`, `version`,
`previous` (the newest release before it, or null) and `changed` (the released files that changed).

## Derived views

`packages/journal/src/derive/` holds pure functions over rows (plan items obs-person-attention and
obs-time-and-rework). Each reads rows and writes nothing, counts a row read twice once, and names the rows (or PRs) each
output came from. `packages/journal/bin/derive.js time|rework|overhead` runs them from the command line. What each
counts, and why, is in `plan/decisions/2026-10-30-obs-time-and-rework.md`.

- **`time.js`**: per session, working time (a turn from its wake to its Stop row, a tool call or hook run for its
  `ms`, a subagent from spawn to finish) and every gap between, labelled by the wake whose turn ends it: `person`
  (`mention`, `decision-chosen`, `prompt`), `ci` (`external-event`), `wake` (any other reason), `rebuild` (from a
  SessionStart inside the gap to that wake) or `unknown` (no wake, no reason, or the turn before never closed). A gap
  is never working, and working plus each waiting kind plus unknown is the session's wall-clock time.
- **`rework.js`**: per PR, pushes (commits CI ran on), red pushes, red runs, rounds (a new one at each push after a red
  one, a merge commit staying in its round) and replans (other PRs labelled `replan` naming the same item), from
  `ci.result` rows. `tripwires()` gives the `tripwire` rows to append: one per PR and limit, when rounds pass the
  item's `step_back.max_rounds` (default 2). Before the engine, rounds are per PR, not per item.
- **`overhead.js`**: tokens (`turn.usage` and `agent.finish`) on harness work against product work. A session's
  tokens split by the share of changed lines, over the PRs its commits name it on, in the paths
  `packages/journal/harness-paths.json` lists (`<owner>/<repo>/<glob>`). A session with no PR is unattributed.

### PR check rows

`derive.js rework` reads each PR from GitHub REST (the PR, its commits, each commit's check runs, its files) and makes
one `ci.result` row per completed check run, `id` `github-check-run-<run id>`, `at` the run's completion, `source`
`github` and the run id. `payload`: `workflow` (the check's name), `repo`, `pr`, `sha`, `merge` (the commit has two
parents), `result` (the run's conclusion), `startedAt`, `completedAt`, `item` (the PR's `Item:` line, else its
branch's last segment) and `labels`. With `--append` it adds the rows the journal file lacks, and the new tripwires.

`tripwire` payload: `repo`, `pr`, `rounds`, `limit`, `item` and `inputs` (the `ci.result` row ids counted). The
tripwire row only records. The engine acts on it (plan item engine-item-views): `--append` it to the item's own file
(`items/<item>.jsonl`), and the host's next call offers it once as a `tripwire` event (`packages/engine/src/tripwire.js`,
source `journal`, `tripwire <row id>`); quick-fix steps back to replanning when the event names the item's PR.

## The observe page

`plugins/harness/pages/observe/` (plan item obs-page) is the person's live page over the journal, published as a
claude.ai artifact: https://claude.ai/artifact/GEVcccpqcToRUb7EhTG4B3. For everything, a UTC day, a thread, a session or an item
it shows tokens by agent (`turn.usage` for the main session, `agent.finish` per subagent), time by kind (the time
view's totals), what was refused with its rule and whether it was retried, and what was asked of the person (the
attention view's cards, posts, messages, taps and waits). It shows its own release, the newest release that wrote
rows, the newest row's time and when it last read.

- An item is a scope too (plan item engine-item-views). Its view gives the workflow, current state and since when,
  the handles its events carried (issue, PR and head, verdict, merge), build rounds, tokens and person asks, read
  across every journal file: the agents its `agent.spawn` rows bound, wherever their `agent.finish` rows are, each at
  its last row (an `agent.finish` row covers the agent's whole transcript, so an agent that finished twice is not
  summed; the tokens-by-agent table and `overhead.js` count the same way); the turns of the sessions that applied
  its events; and each ask run's card, joined by the card id on its `engine.effect` done row to the `card.posted` and
  `person.tap` rows of any session, so a card posted and tapped in the owning thread counts. Its wait runs from the
  card going up to the answer reaching the item. An invoked actor's own rows carry its item and state (capture
  reads the actor hook's binding).
- `data.js` is the data layer, pure functions over rows; `page.html` is the page. `build.mjs` inlines `data.js` and
  the derived views it uses into `observe.html`, the file that is published, so the page runs the code the tests run.
  A test fails when `observe.html` is stale. Rebuild with `node plugins/harness/pages/observe/build.mjs --release
  x.y.z` and republish that file with the capabilities `files` (`{ project: <this project's chan id> }`), `db` and
  `user`.
- It reads `harness/journal/**/*.jsonl` through the artifact's `files` capability, once after the page loads and on
  each Refresh. Nothing runs on a timer.
- Each read writes one `page.refresh` row to the page's own store (collection `refresh`, read with ArtifactData),
  since `files` can only read. The row is a journal row, session `page-observe`, `source` `artifact` and the page url;
  `payload`: `page`, `ms` (reading and deriving), `rows`, `files`, `bad` (unreadable lines), `newestAt`, `scope` and
  `viewer` (the viewer's opaque id). Why: `plan/decisions/2026-10-30-obs-page.md`.
- `test/browser-check.mjs <folder>` opens `observe.html` in Chromium with a stand-in viewer serving `<folder>` as
  the project's files, presses Refresh and prints what the page shows and the rows it recorded.

## Engine rows

The engine host (plan item engine-host, `packages/engine/src/host.js`) writes these to the item's own file,
`<journal root>/items/<item>.jsonl`. The session that started the item owns that file and is its only writer; its
first row creates the file exclusively. `restore()` reads that one file by its path and never lists a folder
(L-library-mount-slow). `item` is the item id and `state` the item's state (as JSON) after the row.

`engine.transition`: one row per event offered to the item, applied or not. `source` is where the event came from,
recorded at write time (L-record-route-at-write): `github` and a hash of the GitHub event's kind and JSON (so a
redelivery has the same source), `hearth` and the card id for a tap, `claude-code` and the task id for a worker's
failure (or the session id for the start), `timer` and the timer id, or `engine` and the effect id for what an
effect reported. A source already offered is a duplicate. `id` is the transition id, `<item>#<seq>`, on an applied row.

| Field | What |
|---|---|
| transition | `<item>#<seq>` when applied, else null |
| seq | The transition's place in the item, from 0 (the start), or null when not applied |
| outcome | `applied`, `duplicate` (that source was already offered), `stale` (a completion from a run no longer in flight, or a timer no longer set), `refused` (the workflow doesn't take it now, or its payload fails the schema) or `not-owner` |
| reason | Why it wasn't applied, or null |
| workflow | The workflow's id |
| event | The event as offered; replay applies it again |
| run | The run effect id a completion answers, or null |
| from | The state before (as JSON), on an applied row |
| hash | `hashOf` the snapshot after, on an applied row; restore checks each one |

A `not-owner` row, and a `refused` row for an item that hasn't started, go to the offering session's own file
(`sessions/<session>.jsonl`), since only the owner writes the item's file.

`engine.effect`: a row when an effect starts and one when it ends. Effect ids name the effect for good:
`<item>:<seq>.<invoke id>` for a run, `<item>:<seq>.<timer id>` for a timer, with `:stop` or `:cancel` added when
the state that started it was left. `payload`: `effect`, `type` (`run`, `stop`, `timer`, `cancel`), `phase` (`start`,
then `done`, `refused`, `failed` or `unknown`), `transition` (the transition that asked for it), `actor` (a run's
actor), `timer` and `due` (a timer's), `outcome` (what the handler reported, such as the card or task id it made),
`rule` (what refused it) and `reason`. A merge's `done` outcome is `{ ref, repo, number, head, sha }`: `owner/repo#n`,
the verified head it merged at and GitHub's merge sha. A card's is `{ ref, choices }`, a post's `{ ref }` and a
timer's `{ ref, due }` (plan item engine-effects). An effect that has ended is never run again. One that started and never ended
(the host stopped mid-effect) is looked up with its handler's `find()`, or journalled `unknown` and left alone.

## Actor rows

The engine's actor runs (plan item engine-actors, `packages/engine/src/actors.js`) write these to the item's own file,
beside its engine rows, with `item` and the `state` the run was started in. A run's folder is
`<journal root>/items/<item>/runs/<seq>.<invoke>/`: `brief.md`, `context.md`, `run.json`, `spawn.json` (the Agent call
that started it), `agent.json` (the agent bound to it) and `result.json` (its accepted result). Brief and result texts
are blobs, `<journal root>/blobs/<sha256>`, as capture stores them.

| When | Kind | `payload` |
|---|---|---|
| A run is prepared (its brief), or a `brief` actor's result is accepted (each brief it returned, fixed before any build starts) | `brief.stored` | `run`, `actor`, `role` (the actor, or `builder`/`verifier` for returned briefs), `hash`, `bytes`; a prepared run also has `contextHash` and `worktree` |
| The harness binds an agent to the run its Agent call started | `agent.spawn` | `agentId`, `type`, `run`, `actor`, `briefHash`, `worktree`, `via` (`start`: found at SubagentStart; `meta`: from the agent's meta.json at its first call), `hookSession` |
| A return or bind the actor hook refused | `refusal` | `source` `hook`, `rule` (`wrong-caller`, `schema`, `github-fact`, `already-returned`, `already-failed`, `unknown-run`; `no-return` when an actor ended again after being sent back to return, or stopped after a handback, `tool` `SubagentHandback` or `SubagentStop`), `reason` (names the missing field or fact), `run`, `actor`, `caller`, `tool`, `textHash`, `outcome` `denied` |
| A return passed every check | `result.stored` | `run`, `actor`, `agentId`, `hash`, `bytes`, `toolUseId` |

The completion an accepted result makes is an `engine.transition` whose source is `harness` and `return <tool use id>`.
An invoked actor's `tool.call` rows (capture, session file) also carry `paths`: the file a file tool named, the
folder a search ran in, or the folder a shell command ran from. They are the one piece of a tool's input a row keeps,
and only for an agent bound to a run, so the journal shows where each actor worked.

## Adding a kind

1. Add it to `KINDS` in `packages/journal/src/kinds.js` (dotted lower-case words). `append()` refuses kinds not on
   the list; readers accept any well-formed kind, so older readers still read the new rows.
2. Add a row to the table above saying what it records and what its `source` is.
3. Add the kind's payload fields to the item that writes it, with a test that a row of the kind validates.
