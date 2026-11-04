# D-wildcard: a fact board with gates

Stance: wildcard. The workflow writes no data. The host records every event it accepts as a **fact** on the item's
board, and a workflow is a **gate policy** over those facts: which events a state takes, and which facts must hold to
move. XState still runs the control flow. Data reaches the board only through one generic, host-owned fold.

The three workflows are written out as JSON below. They are also saved as files next to this document
(`quick-fix.json`, `feature.json`, `research.json`). A prototype of the spec.js changes (`record` and `always`) ran
them through XState 5.33.3's pure `transition()` for every scenario's state path in section 5. The prototype is at
`/tmp/claude-0/-home-user/be7a61c6-b708-529b-89a7-b211d10b05aa/scratchpad/proto/` (`spec.js`, `try.mjs`).

## 0. The alternative I tried first, and why the board lives in XState context

I started with the board outside XState: a host-side fold of the journal (a tuple space keyed by fact name), with the
machine holding only `value`. That fails two hard constraints at once. `hashOf` and `replay` prove a journal by hashing
`[value, context]`, so a second store needs its own replay proof. And guards and needs would have to read a store that
XState cannot see. So the board sits in `context.facts`, but nothing in a workflow writes to it. The difference from
the baseline is who writes: in the baseline, each transition carries hand-written `set`/`inc` actions (one write path
per transition, 40+ in quick-fix). Here there is one write path, `record`, which the interpreter applies to every
event-taking transition the same way.

## 1. Core rules

1. **Taking an event records it.** When a transition taken on an event (`on`, `after`, invoke `onDone`/`onError`)
   applies, the interpreter writes that event to `facts[<name>]`. The name is the invoke id for an actor's done or
   error event, the event type for an outside event, and `after` for a timer. The value is
   `{ v | err, seen?, n }`. `v` is what the source claimed (output or payload), and `err` is an error. `seen` is
   what the host itself checked when it accepted the claim; an agent can never write it. `n` counts how many times
   this name was recorded on this item. A workflow has no actions: `set` and `inc` are gone, and a spec with
   `actions` is refused at load.
2. **Guards decide whether to take an event; needs decide whether a state may be entered.** A transition's own guard
   reads the facts *before* the record (so `samePr` can refuse a push for another PR). The target's `meta.needs`
   read the facts *after* the record, as today. `always` transitions record nothing and re-check gates after every
   step, so a gate that needs two facts (a verdict and green CI) holds whatever order they arrive in.
3. **Every gating fact names the head it is about, and every gate compares it to the current head.** That makes a
   stale fact harmless instead of dangerous: a verdict, CI result or push for another head just never satisfies a
   gate. Nothing ever has to be cleared.
4. **Claims are checked where they enter.** When the host accepts an agent's result, it checks every claim the result
   makes against the claim's own source of truth and writes what it saw under `seen`. A claimed PR is checked against
   GitHub and against the claimant's worktree HEAD. A claimed source `{url, quote}` is fetched by the host itself.
   Gates that certify done read `seen` and person taps, never an agent's bare word.
5. **An attempt is an item.** Replanning does not reset anything. It starts a child item of the same workflow, with the
   person's `why` added to its input, so a new attempt starts with an empty board by construction. Slices (feature)
   and sub-questions (research) are child items too, all started by one effect, `items`, and joined by the host.
6. **A workflow runs on the rules it started with.** The host pins the spec's bytes when an item starts, and restore
   always replays an item on its pinned spec.

## 2. Primitives (in the pack's kinds), versus the baseline

| Kind | Primitive | Status | Used by |
|---|---|---|---|
| state kind | normal | kept | all |
| state kind | final | kept | all |
| transition kind | invoke onDone / onError | kept | all |
| transition kind | on | kept (a targetless `on` now means "take and record") | quick-fix |
| transition kind | after | kept | quick-fix, research |
| transition kind | reenter | kept | all (replanning re-ask; quick-fix push) |
| transition kind | **always** | **new (interpreter: spec.js)** | quick-fix (checking gates), research (leaf/root routing) |
| context op | set | **removed** | none |
| context op | inc | **removed** | none |
| context op | **record** (implicit on every event transition; fact naming, `n`, `seen`, pre/post guard timing) | **new (interpreter: spec.js)** | all |
| guard form | present, is, in, same, below | kept | all (in, below: quick-fix, research) |
| spec convention | meta.needs | kept | all |
| spec convention | meta.actors, meta.events, meta.input (schemas) | kept | all |
| effect type | run, stop, timer, cancel | kept | all |
| effect type | **items**: start child items of a named workflow, one per element, all at once or in order, and join them | **new** (effects/items.js; not spec.js/host.js) | all three (feature slices + final, research leaves, replan attempts) |
| event shape | xstate.done.actor.* / xstate.error.actor.* | **changed**: a done event may carry `seen`, written by the host | all |
| event shape | timers (xstate.after.*) | kept | quick-fix, research |
| event shape | github.<kind> | kept (`check_run.completed`, `check_suite.completed`, `pull_request.closed`, as the real wakes deliver them) | quick-fix |
| event shape | `pr` {url, branch, headSha} | **changed** (replaces `pr.pushed {headSha}`: carries the whole PR handle, so a push and a build write the same fact) | quick-fix |
| event shape | tripwire | **removed** (rounds are bounded by `facts.pr.n`) | none |
| handle form | PR {url, branch, headSha} | kept | quick-fix (feature through it) |
| cross-item relation | **parent/child item**: child id `<parent run id with ':'→'~'>.<k>`, its start sourced `engine <run id>#<k>` | **new** | all three |
| accept-time check | claimed PR | **changed**: still GitHub at the claimed head; now also the claimant's worktree HEAD, and it records `seen.github {ref, head, base, toDefault, ci}` | quick-fix |
| accept-time check | **claimed source**: host fetches each `{url, quote}`, refuses a quote not found, stores the page as a blob, records `seen.sources` | **new** | research |
| load-time check | **pinned workflow**: spec stored as a blob at start; restore replays on it | **new (interpreter: host.js)** | all |

Count: 22 kept, 3 changed, 6 new, 3 removed (set, inc, tripwire). Interpreter features: 3 (`record` and `always` in spec.js, `pin` in
host.js).

Deleted from my own design after checking that the scenarios still held: `meta.fresh` (a state convention that
cleared the board on replan). Attempts as child items replaced it. Also deleted: a merge-effect "expected base"
check, a `by` provenance stamp on every fact, approvals bound to what the card showed, and card detail rendering.
Section 6 says why each one can go.

### Interpreter changes, exactly

**spec.js: `record`** (replaces `ops.set`, `ops.inc`):
- Context is created as `{ facts: { input: { v: <input>, n: 1 } } }`. A spec's `context` key is ignored, and none of
  the three has one.
- Path scope is `{ facts: context.facts, event }` for guards, needs, invoke input and output. Paths start with
  `facts.` or `event.`. `{ "value": x }` is still a literal.
- `factName(type)`: `xstate.done.actor.<id>` and `xstate.error.actor.<id>` give `<id>`, `xstate.after.*` gives
  `after`, and anything else gives `type`. A dotted name nests: `github.check_suite.completed` is
  `facts.github.check_suite.completed`.
- `record(context, event)`: `{type, output, error, seen, ...payload} = event`. The fact is `{ v: output }` (done),
  `{ err: error }` (error), `{ v: type }` (timer) or `{ v: payload }` (outside event). If `seen` is present it becomes
  `fact.seen`. `fact.n = (previous fact at that name)?.n + 1`, or 1. Written with `setIn` at the name's path.
- `bindTransition(spec, siblings, state, t, eventful)`: throws if `t.actions` is set. For eventful transitions it adds
  `actions: [{type: 'record'}]`. The bound guard is
  `own guard holds on {facts, event}` **and** `target needs hold on {facts: record(context, event).facts, event}`.
  For `always` (`eventful = false`), both read the current facts.
- `machineOf` registers one action, `record: assign(({context, event}) => record(context, event))`.

**spec.js: `always`**: `bindState` binds `state.always` with `eventful = false`. Every `always` candidate in these
specs has a target. The scratchpad prototype (`proto/spec.js`) contains both spec.js changes.

**host.js: `pin`**:
- In `applyEvent`, for the start event (seq 0): `text = JSON.stringify(host.spec)`,
  `hash = sha256(text)`, write `blobs/<hash>` if it is missing, and add `payload.spec = hash` to the seq-0 transition row.
- In `restore`: if the item's applied seq-0 row has `payload.spec`, read `blobs/<hash>` and use it as `host.spec`
  (and `host.machine = machineOf(it)`) before replaying, whatever spec the caller passed. A missing blob throws,
  failing closed. The passed spec is used only for an item with no seq-0 row.

### Code outside spec.js/host.js

- **actors.js `attest({ result, worktreeHead, github, fetchText }) -> { seen } | { refused: { rule, reason } }`**,
  exported and called by `accept()` after the schema check (replacing the inline claimed-PR loop):
  - For each `{url, headSha}` in the result (`claimedPrs`): GitHub's `pull` must show `head.sha === headSha` (rule
    `github-fact`, as today), and `worktreeHead === headSha` (rule `worktree-head`; `accept` passes
    `git -C <run.worktree> rev-parse HEAD`). Then it calls `github.files(ref)` (GET `/repos/{o}/{r}/pulls/{n}/files`,
    a new client method) and records
    `seen.github = { ref: "o/r#n", head, base: pull.base.ref, toDefault: pull.base.ref === pull.base.repo.default_branch, ci: files whose name starts with ".github/" }`.
    A result in these workflows claims one PR. If it claims more, `seen.github` describes the first.
  - For each `{url, quote}` in the result (any depth): `fetchText(url)` (the proxy-aware `send` from github.js, GET,
    a 2xx answer), and `quote` must appear in the body after collapsing whitespace (rule `source-fact`). The body is
    stored as `blobs/<sha256>`, and `seen.sources = [{ url, quote, blob }]`.
  - `accept` writes `seen` into `result.json`, and `resultsOf` puts it on the event:
    `{ type: 'xstate.done.actor.<invoke>', output: result, seen }`.
- **effects/items.js** (the `items` actor; `handlers({ ..., items })` adds it to `byActor`):
  - Input after path mapping: `{ workflow, each, as?, inOrder?, ...rest }`. Children are `[each].flat()`.
    Child k's input is `as ? { ...rest, [as]: child } : { ...child, ...rest }`, with undefined keys dropped.
  - Child id: `effect.id.replace(':', '~') + '.' + k` (for example `it-1~7.slices.0`).
  - `start(effect)`: start child 0 (`inOrder`) or every child. To start one: restore it with
    `loadWorkflow(workflow)`, and if it has no snapshot, `offer(child, [{ event: { type: 'xstate.init', input },
    source: { system: 'engine', ref: effect.id + '#' + k } }], handlersFor(child))`. The child file's exclusive
    create (`persist`, `wx`) refuses a second start. Returns `{ ref: effect.id, children: ids }` with no output, so
    the run stays open. With no children it returns output `{ total: 0, done: 0, found: [], items: [] }` at once.
    `find` is the same as `start`, since starting is idempotent.
  - `advance(host, { handlersFor }) -> inputs` is called by the wake loop like `resultsOf` and `tripwiresOf`, and does
    nothing unless this session owns the item. For each open `items` run it restores the children. In order, it
    starts child k once child k-1 ended in `done`. Parallel children all started at once. The join completes when
    every child is final (parallel), or when the in-order walk reaches the end or a child that ended in any final
    other than `done`. Completing gives
    `{ event: { type: 'xstate.done.actor.<invoke>', output: { total, done, found, items } }, run, source: { system: 'engine', ref: run + ':joined' } }`.
    `items` is `[{ item, state, output }]` (`state` is `not-started` for a child never started). `done` counts
    children whose final state is named `done`. `found` holds their outputs.
- **Test world** (`test/parity/world.js`): `fakeGitHub` PRs gain `base` (default `main`) and `files`. The GET pull
  answers `base: { ref, repo: { default_branch: 'main' } }`, plus GET `/pulls/{n}/files`. A new `fakeWeb(pages)`
  serves source pages. A new `attested(host, actor, output, { gh, worktreeHead, web })` runs `attest` and returns the
  host input that `resultsOf` would give, with `seen`. `advance` and a `drive(hosts)` helper offer due inputs to
  every open item.

## 3. The state store for each workflow

Every workflow starts with `{ "facts": { "input": { "v": <input>, "n": 1 } } }`, and only `record` adds to it. Each
board below is shown at its fullest. A key is present only once that event has been taken.

quick-fix (input `{ issue: {url, expect[]}, base?, from?, why? }`):

```json
{ "facts": {
  "input":   { "v": { "issue": { "url": "…/issues/7", "expect": ["…"] }, "base": "feature/x", "from": "feature/x", "why": "…" }, "n": 1 },
  "briefs":  { "v": { "builder": "…", "verifier": "…" }, "n": 1 },
  "pr":      { "v": { "url": "…/pull/1", "branch": "build/x", "headSha": "<sha>" },
               "seen": { "github": { "ref": "o/r#1", "head": "<sha>", "base": "main", "toDefault": true, "ci": [] } }, "n": 2 },
  "verify":  { "v": { "result": "PASS", "pr": { "url": "…/pull/1", "headSha": "<sha>" }, "report": "…" },
               "seen": { "github": { "ref": "o/r#1", "head": "<sha>", "base": "main", "toDefault": true, "ci": [".github/workflows/ci.yml"] } }, "n": 1 },
  "github":  { "check_run":   { "completed": { "v": { "check": "test", "conclusion": "failure", "head_sha": "<sha>", "details_url": "…" }, "n": 1 } },
               "check_suite": { "completed": { "v": { "head_sha": "<sha>", "pr": "o/r#1" }, "n": 1 } },
               "pull_request": { "closed": { "v": { "outcome": "merged", "pr": "o/r#1" }, "n": 1 } } },
  "approval":{ "v": { "choice": "approve", "by": "<account>" }, "n": 1 },
  "merge":   { "v": { "sha": "<sha>" }, "n": 1 },
  "replan":  { "v": { "choice": "replan", "by": "<account>", "why": "…" }, "n": 1 },
  "attempt": { "v": { "total": 1, "done": 1, "found": [ { "pr": {}, "verdict": {}, "merge": {} } ], "items": [ { "item": "it-1~9.attempt.0", "state": "done", "output": {} } ] }, "n": 1 },
  "after":   { "v": "xstate.after.buildTimeout.quick-fix.building", "n": 1 }
} }
```

feature (input `{ goal: {url, expect[]}, why? }`):

```json
{ "facts": {
  "input":   { "v": { "goal": { "url": "…/issues/20", "expect": ["…"] } }, "n": 1 },
  "plan":    { "v": { "branch": "feature/x", "slices": [ { "url": "…/issues/20#s1", "expect": ["…"] }, { "…": "…" }, { "…": "…" } ] }, "n": 1 },
  "slices":  { "v": { "total": 3, "done": 3, "found": ["…"], "items": [ { "item": "f-1~1.slices.0", "state": "done", "output": {} } ] }, "n": 1 },
  "final":   { "v": { "total": 1, "done": 1, "found": ["…"], "items": [ { "item": "f-1~2.final.0", "state": "done", "output": {} } ] }, "n": 1 },
  "replan":  { "v": { "choice": "replan", "by": "…", "why": "…" }, "n": 1 },
  "attempt": { "v": { "total": 1, "done": 1, "found": [], "items": [] }, "n": 1 }
} }
```

research (input `{ question, leaf?, why? }`):

```json
{ "facts": {
  "input":    { "v": { "question": "…", "leaf": true }, "n": 1 },
  "plan":     { "v": { "questions": ["…", "…", "…"], "writer": "…", "verifier": "…" }, "n": 1 },
  "answers":  { "v": { "total": 3, "done": 2, "found": [ { "question": "…", "answer": { "text": "…", "sources": [] }, "sources": [ { "url": "…", "quote": "…", "blob": "<sha256>" } ] } ], "items": [] }, "n": 1 },
  "answer":   { "v": { "text": "…", "sources": [ { "url": "…", "quote": "…" } ] }, "seen": { "sources": [ { "url": "…", "quote": "…", "blob": "<sha256>" } ] }, "n": 1 },
  "report":   { "v": { "text": "…", "sources": [ { "url": "…", "quote": "…" } ] }, "seen": { "sources": [ { "url": "…", "quote": "…", "blob": "<sha256>" } ] }, "n": 1 },
  "verify":   { "v": { "result": "PASS", "report": "…" }, "n": 1 },
  "approval": { "v": { "choice": "publish", "by": "…" }, "n": 1 },
  "published":{ "v": { "ref": "cmsg_…" }, "n": 1 }
} }
```

(`answer` exists only on a leaf. `plan`, `answers`, `report`, `verify`, `approval` and `published` exist only on a
root.)

## 4. States and transitions (spec format plus `always` and the record rules above)

### quick-fix

```json
{
  "id": "quick-fix",
  "description": "Issue to merged commit. Events only record facts; states gate on facts bound to the PR's current head. A replan starts a fresh attempt as a child item.",
  "initial": "briefing",
  "output": { "pr": "facts.pr.v", "verdict": "facts.verify.v", "merge": "facts.merge.v", "attempt": "facts.attempt.v" },
  "states": {
    "briefing": {
      "invoke": { "id": "briefs", "src": "brief", "input": { "input": "facts.input.v" }, "onDone": "building", "onError": "replanning" }
    },
    "building": {
      "meta": { "needs": ["hasBriefs"] },
      "invoke": {
        "id": "pr",
        "src": "build",
        "input": { "input": "facts.input.v", "brief": "facts.briefs.v.builder", "verdict": "facts.verify", "ci": "facts.github" },
        "onDone": "checking",
        "onError": "replanning"
      },
      "after": { "buildTimeout": "replanning" }
    },
    "checking": {
      "meta": { "needs": ["hasPr"] },
      "invoke": {
        "id": "verify",
        "src": "verify",
        "input": { "input": "facts.input.v", "brief": "facts.briefs.v.verifier", "pr": "facts.pr.v" },
        "onDone": [
          { "target": "building", "guard": "failedWithRound" },
          { "target": "replanning", "guard": "failed" },
          {}
        ],
        "onError": "replanning"
      },
      "on": {
        "pr": { "target": "checking", "reenter": true, "guard": "samePr" },
        "github.check_suite.completed": { "guard": "suiteOnHead" },
        "github.check_run.completed": [
          { "target": "building", "guard": "redWithRound" },
          { "target": "replanning", "guard": "red" }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "closedOnPr" }
      },
      "always": [
        { "target": "merging", "guard": "intoBase" },
        { "target": "awaitingCiMerge", "guard": "ciChanged" },
        { "target": "awaitingMerge" }
      ]
    },
    "awaitingMerge": {
      "meta": { "needs": ["ready"] },
      "invoke": {
        "id": "approval",
        "src": "ask",
        "input": { "question": { "value": "Merge this PR at the verified commit?" }, "choices": { "value": ["approve", "reject"] }, "pr": "facts.pr.v", "verdict": "facts.verify.v" },
        "onDone": [{ "target": "merging", "guard": "approved" }, { "target": "replanning" }],
        "onError": "replanning"
      },
      "on": {
        "pr": { "target": "checking", "guard": "samePr" },
        "github.check_run.completed": [
          { "target": "building", "guard": "redWithRound" },
          { "target": "replanning", "guard": "red" }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "closedOnPr" }
      }
    },
    "awaitingCiMerge": {
      "meta": { "needs": ["ready", "ciChanged"] },
      "invoke": {
        "id": "approval",
        "src": "ask",
        "input": {
          "question": { "value": "This PR changes CI config (.github/), so its green CI ran the PR's own config. Merge it at the verified commit anyway?" },
          "choices": { "value": ["approve CI change", "reject"] },
          "pr": "facts.pr.v",
          "verdict": "facts.verify.v",
          "ci": "facts.verify.seen.github.ci"
        },
        "onDone": [{ "target": "merging", "guard": "approvedCi" }, { "target": "replanning" }],
        "onError": "replanning"
      },
      "on": {
        "pr": { "target": "checking", "guard": "samePr" },
        "github.check_run.completed": [
          { "target": "building", "guard": "redWithRound" },
          { "target": "replanning", "guard": "red" }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "closedOnPr" }
      }
    },
    "merging": {
      "meta": { "needs": ["ready"] },
      "invoke": { "id": "merge", "src": "merge", "input": { "pr": "facts.pr.v", "sha": "facts.verify.v.pr.headSha" }, "onDone": "done", "onError": "replanning" }
    },
    "replanning": {
      "invoke": {
        "id": "replan",
        "src": "ask",
        "input": { "question": { "value": "This item stalled. Replan it with a written five whys, or drop it?" }, "choices": { "value": ["replan", "drop"] }, "facts": "facts" },
        "onDone": [
          { "target": "replanned", "guard": "replan" },
          { "target": "dropped", "guard": "drop" },
          { "target": "replanning", "reenter": true }
        ],
        "onError": "dropped"
      }
    },
    "replanned": {
      "invoke": {
        "id": "attempt",
        "src": "items",
        "input": { "workflow": { "value": "quick-fix" }, "each": "facts.input.v", "why": "facts.replan.v.why" },
        "onDone": [{ "target": "done", "guard": "allDone" }, { "target": "dropped" }]
      }
    },
    "done": { "type": "final" },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "hasBriefs": ["facts.briefs.v.builder", "facts.briefs.v.verifier"],
      "hasPr": ["facts.pr.v.url", "facts.pr.v.headSha"],
      "ready": [
        { "path": "facts.verify.v.result", "is": "PASS" },
        { "path": "facts.verify.v.pr.headSha", "same": "facts.pr.v.headSha" },
        { "path": "facts.github.check_suite.completed.v.head_sha", "same": "facts.pr.v.headSha" }
      ],
      "failed": [{ "path": "event.output.result", "is": "FAIL" }],
      "failedWithRound": [{ "path": "event.output.result", "is": "FAIL" }, { "path": "facts.pr.n", "below": 2 }],
      "samePr": [{ "path": "event.url", "same": "facts.pr.v.url" }],
      "suiteOnHead": [{ "path": "event.head_sha", "same": "facts.pr.v.headSha" }],
      "red": [{ "path": "event.conclusion", "in": ["failure", "timed_out"] }, { "path": "event.head_sha", "same": "facts.pr.v.headSha" }],
      "redWithRound": [{ "path": "event.conclusion", "in": ["failure", "timed_out"] }, { "path": "event.head_sha", "same": "facts.pr.v.headSha" }, { "path": "facts.pr.n", "below": 2 }],
      "closedOnPr": [{ "path": "event.pr", "same": "facts.verify.seen.github.ref" }],
      "intoBase": [{ "path": "facts.verify.seen.github.base", "same": "facts.input.v.base" }, { "path": "facts.verify.seen.github.toDefault", "is": false }],
      "ciChanged": ["facts.verify.seen.github.ci"],
      "approved": [{ "path": "event.output.choice", "is": "approve" }],
      "approvedCi": [{ "path": "event.output.choice", "is": "approve CI change" }],
      "replan": [{ "path": "event.output.choice", "is": "replan" }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "is": "drop" }],
      "allDone": [{ "path": "event.output.done", "same": "event.output.total" }]
    },
    "delays": { "buildTimeout": 3600000 },
    "input": {
      "type": "object",
      "required": ["issue"],
      "properties": {
        "issue": { "$ref": "#issue" },
        "base": { "type": "string", "minLength": 1 },
        "from": { "type": "string", "minLength": 1 },
        "why": { "type": "string", "minLength": 1 }
      }
    },
    "events": {
      "pr": { "$ref": "#pr" },
      "github.check_suite.completed": { "type": "object", "required": ["head_sha"], "properties": { "head_sha": { "$ref": "#sha" } } },
      "github.check_run.completed": {
        "type": "object",
        "required": ["check", "conclusion", "head_sha"],
        "properties": { "check": { "type": "string", "minLength": 1 }, "conclusion": { "type": "string" }, "head_sha": { "$ref": "#sha" } }
      },
      "github.pull_request.closed": { "type": "object", "required": ["outcome", "pr"], "properties": { "outcome": { "type": "string" }, "pr": { "type": "string" } } }
    },
    "actors": {
      "brief": { "type": "object", "required": ["builder", "verifier"], "properties": { "builder": { "type": "string", "minLength": 1 }, "verifier": { "type": "string", "minLength": 1 } } },
      "build": { "$ref": "#pr" },
      "verify": {
        "type": "object",
        "required": ["result", "pr", "report"],
        "properties": {
          "result": { "enum": ["PASS", "FAIL"] },
          "pr": { "type": "object", "required": ["url", "headSha"], "properties": { "url": { "type": "string" }, "headSha": { "$ref": "#sha" } } },
          "report": { "type": "string", "minLength": 1 }
        }
      },
      "ask": { "$ref": "#ask" },
      "merge": { "type": "object", "required": ["sha"], "properties": { "sha": { "$ref": "#sha" } } },
      "items": { "$ref": "#join" }
    },
    "schemas": {
      "sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
      "issue": { "type": "object", "required": ["url", "expect"], "properties": { "url": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } },
      "pr": { "type": "object", "required": ["url", "branch", "headSha"], "properties": { "url": { "type": "string", "minLength": 1 }, "branch": { "type": "string", "minLength": 1 }, "headSha": { "$ref": "#sha" } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "join": { "type": "object", "required": ["total", "done", "found", "items"], "properties": { "total": { "type": "integer" }, "done": { "type": "integer" }, "found": { "type": "array" }, "items": { "type": "array" } } }
    }
  }
}
```

### feature

```json
{
  "id": "feature",
  "description": "One goal, several PRs. Slices are quick-fix child items run in order into a feature branch; the whole goal is then one more quick-fix child, from that branch into the default branch, verified against the goal and approved with one tap.",
  "initial": "planning",
  "output": { "branch": "facts.plan.v.branch", "slices": "facts.slices.v", "final": "facts.final.v", "attempt": "facts.attempt.v" },
  "states": {
    "planning": {
      "invoke": { "id": "plan", "src": "brief", "input": { "input": "facts.input.v" }, "onDone": "slicing", "onError": "replanning" }
    },
    "slicing": {
      "meta": { "needs": ["hasPlan"] },
      "invoke": {
        "id": "slices",
        "src": "items",
        "input": { "workflow": { "value": "quick-fix" }, "each": "facts.plan.v.slices", "as": { "value": "issue" }, "inOrder": { "value": true }, "base": "facts.plan.v.branch" },
        "onDone": [{ "target": "finishing", "guard": "allDone" }, { "target": "replanning" }]
      }
    },
    "finishing": {
      "invoke": {
        "id": "final",
        "src": "items",
        "input": { "workflow": { "value": "quick-fix" }, "each": "facts.input.v.goal", "as": { "value": "issue" }, "from": "facts.plan.v.branch" },
        "onDone": [{ "target": "done", "guard": "allDone" }, { "target": "replanning" }]
      }
    },
    "replanning": {
      "invoke": {
        "id": "replan",
        "src": "ask",
        "input": { "question": { "value": "This feature stalled. Replan it with a written five whys, or drop it?" }, "choices": { "value": ["replan", "drop"] }, "facts": "facts" },
        "onDone": [
          { "target": "replanned", "guard": "replan" },
          { "target": "dropped", "guard": "drop" },
          { "target": "replanning", "reenter": true }
        ],
        "onError": "dropped"
      }
    },
    "replanned": {
      "invoke": {
        "id": "attempt",
        "src": "items",
        "input": { "workflow": { "value": "feature" }, "each": "facts.input.v", "why": "facts.replan.v.why" },
        "onDone": [{ "target": "done", "guard": "allDone" }, { "target": "dropped" }]
      }
    },
    "done": { "type": "final" },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "hasPlan": ["facts.plan.v.branch", "facts.plan.v.slices"],
      "allDone": [{ "path": "event.output.done", "same": "event.output.total" }],
      "replan": [{ "path": "event.output.choice", "is": "replan" }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "is": "drop" }]
    },
    "input": {
      "type": "object",
      "required": ["goal"],
      "properties": { "goal": { "$ref": "#issue" }, "why": { "type": "string", "minLength": 1 } }
    },
    "events": {},
    "actors": {
      "brief": {
        "type": "object",
        "required": ["branch", "slices"],
        "properties": { "branch": { "type": "string", "minLength": 1 }, "slices": { "type": "array", "minItems": 1, "items": { "$ref": "#issue" } } }
      },
      "ask": { "$ref": "#ask" },
      "items": { "$ref": "#join" }
    },
    "schemas": {
      "issue": { "type": "object", "required": ["url", "expect"], "properties": { "url": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "join": { "type": "object", "required": ["total", "done", "found", "items"], "properties": { "total": { "type": "integer" }, "done": { "type": "integer" }, "found": { "type": "array" }, "items": { "type": "array" } } }
    }
  }
}
```

### research

```json
{
  "id": "research",
  "description": "Question to verified, published report. A root item splits the question into leaf items that each answer with sources the host fetches; the root writes the report from what the leaves found, a verifier checks it against the host's copies of the sources, and the person approves the post.",
  "initial": "start",
  "output": { "question": "facts.input.v.question", "answer": "facts.answer.v", "sources": "facts.answer.seen.sources", "report": "facts.report.v", "published": "facts.published.v", "attempt": "facts.attempt.v" },
  "states": {
    "start": {
      "always": [{ "target": "answering", "guard": "isLeaf" }, { "target": "planning" }]
    },
    "planning": {
      "invoke": { "id": "plan", "src": "brief", "input": { "input": "facts.input.v" }, "onDone": "fanning", "onError": "replanning" }
    },
    "fanning": {
      "meta": { "needs": ["hasQuestions"] },
      "invoke": {
        "id": "answers",
        "src": "items",
        "input": { "workflow": { "value": "research" }, "each": "facts.plan.v.questions", "as": { "value": "question" }, "leaf": { "value": true } },
        "onDone": ["composing", "replanning"]
      }
    },
    "answering": {
      "invoke": {
        "id": "answer",
        "src": "build",
        "input": { "question": "facts.input.v.question", "task": { "value": "Answer the question. Cite every claim as a source { url, quote } whose quote appears verbatim at the url." } },
        "onDone": "done",
        "onError": "failed"
      },
      "after": { "answerTimeout": "failed" }
    },
    "composing": {
      "meta": { "needs": ["someFound"] },
      "invoke": {
        "id": "report",
        "src": "build",
        "input": { "question": "facts.input.v.question", "brief": "facts.plan.v.writer", "answers": "facts.answers.v.found", "verdict": "facts.verify.v" },
        "onDone": "verifying",
        "onError": "replanning"
      }
    },
    "verifying": {
      "invoke": {
        "id": "verify",
        "src": "verify",
        "input": { "question": "facts.input.v.question", "brief": "facts.plan.v.verifier", "report": "facts.report.v.text", "sources": "facts.report.seen.sources" },
        "onDone": [
          { "target": "awaitingApproval", "guard": "passed" },
          { "target": "composing", "guard": "failedWithRound" },
          { "target": "replanning" }
        ],
        "onError": "replanning"
      }
    },
    "awaitingApproval": {
      "invoke": {
        "id": "approval",
        "src": "ask",
        "input": { "question": { "value": "Publish this verified report?" }, "choices": { "value": ["publish", "reject"] }, "report": "facts.report.v", "verdict": "facts.verify.v" },
        "onDone": [{ "target": "publishing", "guard": "publish" }, { "target": "replanning" }],
        "onError": "replanning"
      }
    },
    "publishing": {
      "meta": { "needs": ["approvedReport"] },
      "invoke": { "id": "published", "src": "post", "input": { "text": "facts.report.v.text" }, "onDone": "done", "onError": "replanning" }
    },
    "replanning": {
      "invoke": {
        "id": "replan",
        "src": "ask",
        "input": { "question": { "value": "This research stalled. Replan it with a written five whys, or drop it?" }, "choices": { "value": ["replan", "drop"] }, "facts": "facts" },
        "onDone": [
          { "target": "replanned", "guard": "replan" },
          { "target": "dropped", "guard": "drop" },
          { "target": "replanning", "reenter": true }
        ],
        "onError": "dropped"
      }
    },
    "replanned": {
      "invoke": {
        "id": "attempt",
        "src": "items",
        "input": { "workflow": { "value": "research" }, "each": "facts.input.v", "why": "facts.replan.v.why" },
        "onDone": [{ "target": "done", "guard": "allDone" }, { "target": "dropped" }]
      }
    },
    "done": { "type": "final" },
    "failed": { "type": "final" },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "isLeaf": [{ "path": "facts.input.v.leaf", "is": true }],
      "hasQuestions": ["facts.plan.v.questions"],
      "someFound": ["facts.answers.v.found"],
      "passed": [{ "path": "event.output.result", "is": "PASS" }],
      "failedWithRound": [{ "path": "event.output.result", "is": "FAIL" }, { "path": "facts.report.n", "below": 2 }],
      "publish": [{ "path": "event.output.choice", "is": "publish" }],
      "approvedReport": [{ "path": "facts.approval.v.choice", "is": "publish" }],
      "allDone": [{ "path": "event.output.done", "same": "event.output.total" }],
      "replan": [{ "path": "event.output.choice", "is": "replan" }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "is": "drop" }]
    },
    "delays": { "answerTimeout": 3600000 },
    "input": {
      "type": "object",
      "required": ["question"],
      "properties": { "question": { "type": "string", "minLength": 1 }, "leaf": { "type": "boolean" }, "why": { "type": "string", "minLength": 1 } }
    },
    "events": {},
    "actors": {
      "brief": {
        "type": "object",
        "required": ["questions", "writer", "verifier"],
        "properties": {
          "questions": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
          "writer": { "type": "string", "minLength": 1 },
          "verifier": { "type": "string", "minLength": 1 }
        }
      },
      "build": {
        "type": "object",
        "required": ["text", "sources"],
        "properties": {
          "text": { "type": "string", "minLength": 1 },
          "sources": { "type": "array", "minItems": 1, "items": { "type": "object", "required": ["url", "quote"], "properties": { "url": { "type": "string", "minLength": 1 }, "quote": { "type": "string", "minLength": 1 } } } }
        }
      },
      "verify": { "type": "object", "required": ["result", "report"], "properties": { "result": { "enum": ["PASS", "FAIL"] }, "report": { "type": "string", "minLength": 1 } } },
      "ask": { "$ref": "#ask" },
      "post": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string", "minLength": 1 } } },
      "items": { "$ref": "#join" }
    },
    "schemas": {
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "join": { "type": "object", "required": ["total", "done", "found", "items"], "properties": { "total": { "type": "integer" }, "done": { "type": "integer" }, "found": { "type": "array" }, "items": { "type": "array" } } }
    }
  }
}
```

Size, pretty-printed: quick-fix 674 lines, feature 279, research 464; 1,417 in all. Baseline quick-fix alone is
799. Most of quick-fix is schemas; its states and guards are about 110 lines.

## 5. Scenarios: mechanism and test sequence

Notation: `done(id, output, seen?)` is `xstate.done.actor.<id>`. Test events go through `offer()` on a real host
(world.js), with GitHub as `fakeGitHub`. "Attested" means the result is delivered with `attested(...)`, so `seen` is
what `attest()` really computed against the fake GitHub or web. `suite(h)` is the check_suite wake from the fixture
with `head_sha = h`. `red(h)` is the check_run wake with `conclusion: failure` on `h`. Each test asserts the state
path the prototype produced.

**Q1 Happy path.** *Mechanism:* `checking` invokes verify. The verdict and the green suite are recorded in either
order, and `always → awaitingMerge` fires when `ready` holds: PASS, verdict head equal to PR head, and suite head
equal to PR head. A tap then leads to `merging`, which merges at `facts.verify.v.pr.headSha` (expectedHeadSha). *Test:*
start; `done(briefs)`; attested `done(pr, {…/pull/1, headSha A})`; attested `done(verify, PASS @A)`; `suite(A)` →
`awaitingMerge`, one card; `tapWake(card, 0)` → `merging` → `done`. Assert `gh.merges == [{1, A}]`, one card
(**1 tap**). Second test: `suite(A)` arrives before the verdict, with the same end state.

**Q2 Push after PASS.** *Mechanism:* in `awaitingMerge`, `pr` with `samePr` leads to `checking` (a new verify run for
B), and the old card's run is stopped. `ready` now needs a verdict and a suite on B. The A facts stay on the board but
no gate accepts them. *Test:* reach `awaitingMerge` at A; `gh.push(1, B)`; offer
`{type: 'pr', url: …/pull/1, branch, headSha: B}` → `checking`, and the new verify input has `pr.headSha == B`;
`tapWake(oldCard)` gives no inputs; attested PASS@B leaves the item in `checking` (no suite on B yet); `suite(B)` →
`awaitingMerge`; tap → merged at B. Assert `gh.merges == [{1, B}]`.

**Q3 Red CI.** *Mechanism:* in `checking` (or either awaiting state), `github.check_run.completed` with
`redWithRound` (red, on head, `facts.pr.n < 2`) leads to `building`. The record puts the check into
`facts.github.check_run.completed`, and the build input `ci: facts.github` carries it as a typed failure
`{check, conclusion, head_sha, details_url}`. With `n = 2` the `red` candidate leads to `replanning`. *Test:* build at
A, then `red(A)` → `building`, and the second build run's input `ci.check_run.completed.v.check == 'test'`; build at
B (`n = 2`), then `red(B)` → `replanning` (card). A `red(A)` offered while on B is refused.

**Q4 CI edited by the builder.** *Mechanism:* attest lists the PR's files from GitHub, so
`facts.verify.seen.github.ci = ['.github/workflows/ci.yml']`. In `checking`, `always` tries `awaitingCiMerge` (guard
`ciChanged`) before `awaitingMerge`. Its card asks a different question, and its only approving choice is
`approve CI change` (`approvedCi`). A plain `approve` does not exist on that card. *Test:* fakeGitHub PR 1 with
`files: ['.github/workflows/ci.yml', 'src/x.js']`; reach PASS@A attested and `suite(A)` → assert state
`awaitingCiMerge`, card choices `['approve CI change', 'reject']`, no merge. Tap index 1 (`reject`) → `replanning`,
no merge. In a second run, tap index 0 → merged at A (**1 tap**). Assert the item never entered `awaitingMerge`.

**Q5 Verifier misreports.** *Mechanism:* `attest` refuses with `worktree-head` when the verifier's worktree HEAD is
not the claimed head, so no verdict fact is ever recorded. The run then ends through the existing no-return path
(`failed.json` → `xstate.error.actor.verify`) → `replanning`. *Test:* `attest({ result: PASS @A, worktreeHead: X,
github })` returns `{ refused: { rule: 'worktree-head' } }`. Then, on a host in `checking`, assert `resultsOf(host)`
gives no verify done. Offer `xstate.error.actor.verify` (as the stop path gives it) → `replanning`. Assert
`facts.verify` is absent and nothing merged. A real `accept()` over `gitRepo()` with the worktree at another commit
gives the same refusal row.

**Q6 Late push from a dead attempt.** *Mechanism:* the replan starts attempt 2 as the child item
`it-1~N.attempt.0`, which has an empty board. Attempt 2's PR is #2, so a push naming #1 fails `samePr` and is refused,
not recorded. The parent is in `replanned` and takes no `pr` at all. Attempt 1's build run is closed, so its late
result is stale. *Test:* PR #1 at A FAIL, rebuild at B FAIL → `replanning`; tap `replan` with a why →
`replanned`, and the child starts. In the child: briefs, attested PR #2 at C. Offer
`{type: 'pr', url: …/pull/1, headSha: D}` to the child (refused) and to the parent (refused). Offer attempt 1's
build done with its old run id to the parent (stale). Then PASS@C, `suite(C)`, tap, child `done`; `advance(parent)`
→ parent `done`. Assert `gh.merges == [{2, C}]`.

**Q7 Merge outside the host.** *Mechanism:* `github.pull_request.closed` with `closedOnPr` (`event.pr ==
facts.verify.seen.github.ref`) in `checking`, `awaitingMerge` or `awaitingCiMerge` leads to `replanning`. If that wake
is missed, the merge effect's PUT fails (405), and `merging.onError` leads to `replanning`. Either way the item never
reaches `done`, and `journal-check --host` lists the PR (unchanged). *Test:* reach `awaitingMerge` on #1;
`gh.state[1].merged = true`; offer the `pr-merged` fixture wake → `replanning`; assert `facts.merge` is absent.
Second test: no wake, then a tap → merge 405 → `replanning`. Run journal-check: #1 is in `merges.outsideHost`.

**Q8 Workflow changes in flight.** *Mechanism:* pin. *Test:* reach `awaitingMerge` with `quick-fix.json`. Restore
the item with a changed spec: the approval question edited, guard `approved` renamed, and a new state added. Assert
the restore does not throw, `host.spec` deep-equals the original, and the tap → `merging` → `done`. A new item
started with the changed spec uses it, and its seq-0 row names the other hash.

**Q9 Expect edited on GitHub.** *Mechanism:* grading reads only `facts.input.v.issue.expect`, which the start fixed.
No workflow takes an issue-edit event (`meta.events` has none), so the host refuses it and journals the refusal. No
agent output can write `facts.input`. *Test:* in `building`, offer
`{type: 'github.issues.edited', body: 'expect: something else'}` with source github, outcome `refused`. Finish the
build, and assert the verify run's `input.input.issue.expect` deep-equals the original. The verifier's brief is the
`briefs` fact, fixed before the build.

**F1 Feature: three slices, slice 2 never passes.** *Mechanism:* `slicing` runs `items` in order over
`facts.plan.v.slices`, each a quick-fix child with `base: feature/x`. A slice whose verified PR has
`seen.github.base == input.base` and `toDefault: false` passes `intoBase` and merges into the feature branch with no
card. Slice 2's rounds are bounded by `facts.pr.n < 2` inside its own item, and it escalates to its replanning card.
Slice 1's merge stays on `feature/x` because nothing reverts it. Once every slice is `done`, `finishing` starts one
quick-fix child with `issue: goal, from: feature/x`. Its PR goes into the default branch, so `toDefault: true`, and
it needs the verifier's PASS against **the goal's** expect lines, green CI and one tap. *Test A (escalation):* plan
3 slices. Child 0: attested PR #11 (base feature/x), PASS, suite → `merging` → `done` with no card. `advance` →
child 1: FAIL, rebuild, FAIL → `replanning` card (escalation). Tap `drop` → child 1 `dropped`. `advance` → join
`{total 3, done 1}` → feature `replanning`. Assert `gh.merges == [{11, …}]` (slice 1 kept), child 2 was never
started, and nothing went to main. *Test B (completion):* the same, but tap `replan` + why on child 1. Its attempt
child passes and merges #12, then child 2 merges #13, and the join gives `{3, 3}`. Final child: PR #14 from
feature/x into main, PASS against `goal.expect` (assert the verify input carries the goal's lines), `suite`, card,
tap → merge #14 → feature `done`. **Taps:** 1 for the feature's merge, plus 1 for the escalation in test B. A feature
with no failing slice costs 1 tap.

**F2 Parent restored on another host mid-slice.** *Mechanism:* child ids are fixed by the parent's journal
(run id + index). Starting a child is an exclusive create, `items.find` and `advance` are idempotent, and only the
owner session acts. *Test:* run F1 up to child 0 in `checking`. Restore the parent in a new host object with the same
session, and call `offer(parent, [])` and `advance` twice. Assert one `xstate.init` row in `it~1.slices.0`'s file, no
file for child 1, and one `build` start for slice 1 in `agents.started`. Restore with `session: 'other'`: `advance`
returns `[]` and writes nothing. Calling `items.start` for the same effect again does not add a second init.

**R1 Research.** *Mechanism:* the root plans three questions. `fanning` runs `items` in parallel over them with
`leaf: true`, and each leaf's `always` routes it to `answering`. A leaf's answer is attested: the host fetches every
`{url, quote}` and stores the page. A leaf whose agent errors, or outlives `answerTimeout`, ends in `failed`. Every
leaf ends, so the join ends. `composing` needs `found` to be non-empty. The report is attested the same way, and
`verifying` gives the verifier `facts.report.seen.sources`, the host's own blob copies. `publishing` needs
`facts.approval.v.choice == 'publish'`, and the post effect runs only there. *Test:* `fakeWeb` pages containing the
quotes. Start root → plan → three leaf items. Leaves 0 and 2: attested answers → `done`. Leaf 1:
`xstate.error.actor.answer` → `failed`. `advance` → `{total 3, done 2}` → `composing`. Attested report → `verifying`;
assert the verify input `sources[*].blob` exist under `root/blobs` and match the fetched pages. PASS →
`awaitingApproval`, `plat.posts` empty; tap `publish` → `published` → `done`, and `plat.posts[0].text` is the report.
Negatives: a report citing a quote not on its page is refused (`source-fact`). A leaf that never returns plus a
`timeWake` past `answerTimeout` → `failed`, and the join still completes. **1 tap.**

## 6. Deliberately left out

- **Merge "expected base" check.** A slice merges with no card because the host saw its base was the feature branch
  when it accepted the verdict. An agent could retarget the PR to main between that check and the merge. Closing this
  takes 3 lines in merge.js (read `base.ref` before the PUT). I removed it because no scenario needs it. It is the
  first thing to add back.
- **Board resets (`meta.fresh`).** Not needed: an attempt is a child item, and head-binding makes stale facts
  harmless.
- **Provenance on every fact (`by`).** Who wrote a fact follows from how it got there: approvals only from tap wakes
  on ask runs, `seen` only from `attest`, agent claims only under `v`. No gate needed a stamp.
- **Approval bound to what the card showed, and card detail rendering.** Structure already gives this: a push stops
  the ask run, and the merge uses expectedHeadSha. Q4 is explicit through a separate card and choice, not through
  rendering the file list.
- **CI finishing before the build result is accepted.** A suite on the new head that arrives while the item is in
  `building` is refused, because `facts.pr` still names the old head. The item would then wait in `checking`. That
  is the existing C-waiting-does-not-stall gap. The fix is a host read of the head's check suites in `attest`, or a
  `checking` timer, and I left both out.
- **The push wake mapping.** As in the baseline (`pr.pushed`), the `pr` event is offered with source github. Mapping
  GitHub's `pull_request.synchronize` in wake.js is a separate item.
- **Moving ownership between sessions.** F2 is met with the same session restoring elsewhere, and another session is
  refused. Handing an item to a new owner is out of scope.
- **Workflow files edited by a builder** (C-builder-cannot-change-own-workflow). Pinning protects items already in
  flight, not items started after a bad edit.
- **Porting the parity tests.** The 13 `C-*.test.js` read `context.pr`, `context.verdict` and so on. They need their
  paths moved to `facts.*` and their `pr.pushed` events renamed. Their outcomes are unchanged.
