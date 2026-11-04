# engine

A workflow file (`workflows/*.json`) loaded into XState (`src/spec.js`, plan item wf-quick-fix), and the host that
drives one item of it from what reaches it from outside (`src/host.js` and `src/wake.js`, plan item engine-host).

- `restore({ root, item, spec, session, release })` rebuilds the item from its one file,
  `<root>/items/<item>.jsonl`, checking every recorded hash.
- `applyEvent(host, { event, source, run?, at? })` offers one event and returns its `engine.transition` row and the
  effects it asks for. `persist(host, rows)` appends rows; `runEffects(host, handlers)` carries out the effects once
  each by effect id, and only when the host's session owns the item: another session's host turns its events away
  as `not-owner` and runs none of the item's effects. `offer(host, inputs, handlers)` does all three in turn.
- `inputsOfWake(host, text)` turns a wake the platform delivered into those inputs. It is the only place an event's
  source is read, and it reads it from the envelope or the host's own record.

The rows are in `docs/journal.md`, "Engine rows". Why it is shaped this way: `plan/decisions/2026-10-30-engine-host.md`.

`bin/host.js` runs it from a shell or a hook, one item per call:

```
node packages/engine/bin/host.js start --item <id> --workflow quick-fix --input '<json>' --session <id>
node packages/engine/bin/host.js wake --item <id> --workflow quick-fix < <hook input JSON>
node packages/engine/bin/host.js show --item <id> --workflow quick-fix
node packages/engine/bin/host.js card --item <id> --workflow quick-fix --effect <ask run id> --ref <card id>
node packages/engine/bin/host.js answer --item <id> --workflow quick-fix --effect <ask run id> --choice <c> --by <session> [--grants <file>]
```

`--root` defaults to `$CCP_JOURNAL_DIR` or `/mnt/project-files/harness/journal`.

## Effects

Every outside action an item takes is a host effect, run once per effect id by `runEffects` with the handlers from
`src/effects/index.js` (plan item engine-effects). Each takes an effect and returns its outcome; none runs a shell
command.

| Effect | Made by | Does |
|---|---|---|
| `merge.js` | a run of the `merge` actor | merges `input.pr.url` over GitHub REST with `expectedHeadSha` = `input.sha` (the verdict's sha); a push after the verdict makes GitHub refuse it, the PR stays open and the item gets the actor's error |
| `card.js` | a run of the `ask` actor | puts up a decision card keyed by the effect id; the tap wake is the answer |
| `post.js` | a run of the `post` actor | posts `input.text` in the thread; the message id is the output |
| `timer.js` | a delayed transition | asks the clock for a wake at the due time; the host fires the timer from that wake |

`handlers({ github, hearth, clock })` builds them. `github` (`src/effects/github.js`) reaches api.github.com through
the session's proxy itself. A command can't reach the thread or schedule a wake, so in `bin/host.js` posts and timers
stay pending (and printed). Its cards go through `src/effects/relay.js` (plan item engine-toy-run): the session that
has the thread's tools posts the card `show` lists and records its id with `card`, which then finishes the card
effect with that id as the item's owner (so the item's file names the card; plan item engine-item-views), so the tap wake on that card answers the run. `scripts/toy-run.sh` runs the whole loop;
why: `plan/decisions/2026-10-30-engine-toy-run.md`. Agent actors are
prepared by `src/actors.js` (below).

## Tripwires

A `tripwire` row (`derive.js rework --append items/<item>.jsonl`, when a PR passes its item's round limit) is offered
on the host's next call as a `tripwire` event, once (`src/tripwire.js`, plan item engine-item-views). quick-fix steps
back to replanning from building, verifying or awaitingMerge when the event's PR is the item's.

## Stand-in answers

When the person is away, a stand-in session answers an open ask with `bin/host.js answer` (`src/standin.js`, plan
item engine-cards-standin). The host takes it only when the ask's card is up, the choice is one of the ask's choices,
and an entry in the grants file covers it; otherwise it prints `refused: <why>` and exits 2, and the item is
unchanged. An accepted answer is the ask run's completion, `{ choice, by, grant }`, with source
`{ system: 'standin', ref: '<grant id> <card id>' }`, applied as the item's owner, so the host runs the merge that
follows as it would on a tap. Whichever of a tap and a stand-in answer comes first is applied; the other finds no open
run. The grants file defaults to `grants.json` beside the journal folder (`<harness>/grants.json`):

```json
{ "grants": [{ "id": "…", "workflow": "quick-fix", "ask": "ask", "choices": ["approve", "reject"],
  "repos": ["owner/repo"], "until": "<ISO time>", "granted_by": "…", "said": "the person's words", "said_at": "…" }] }
```

An entry covers an answer when its workflow and ask (the invoke id) match, it lists the choice and the PR's repo, and
`until` is still ahead. The person sets the file; the first one is `plan/decisions/2026-10-31-first-grant.md`.

The journal check (`packages/journal/bin/journal-check.js --repo <owner/name>`) lists every merge the host's merge
effect didn't make, and with `--host` fails on one.

## Actors

A state that invokes `brief`, `build` or `verify` starts an agent (`src/actors.js`, plan item engine-actors). The run
handler writes the run's folder under `<root>/items/<item>/runs/<seq>.<invoke>/`, adds a git worktree named
`<item>--<seq>.<invoke>` on branch `run/<item>/<seq>.<invoke>` (from `--repo`, under `--worktrees`), and journals the
brief's hash. The run stays open until its agent returns:

1. The session calls the Agent tool with the prompt `ccp-run <run>` (bin/host.js prints it under `waiting`, and the
   harness hook names waiting runs after each Agent call and wake). The harness's PreToolUse hook swaps in the brief,
   so the agent's prompt is the brief exactly; a second start of a run is refused.
2. SubagentStart binds the agent to the run and tells it its run, worktree and result schema. Its shell commands run
   from the worktree, and file tools outside it are refused.
3. The agent calls the return tool (`mcp__plugin_ccp-harness_harness__return`, `{ run, result }`). Its PreToolUse hook
   refuses it unless the caller is the run's agent, the result matches the actor's schema and any claimed PR is on
   GitHub at the claimed head (`accept`), then hands the result to the item (`deliver`), which prepares the next runs.
4. If the agent ends without its result accepted, by SubagentHandback (PreToolUse, `handback`) or a plain stop
   (SubagentStop, `stopped`), it is sent back once to call the return tool. The next time it ends, the run fails
   (`failed.json`, a `no-return` refusal row) and the item gets the actor's error event, so it steps back instead of
   waiting. A stop right after a handback fails at once, because a block does not bring that agent back (plan item
   engine-actor-returns).

Rows: `docs/journal.md`, "Actor rows". Why: `plan/decisions/2026-10-30-engine-actors.md`.
