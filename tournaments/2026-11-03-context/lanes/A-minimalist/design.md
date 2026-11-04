# Design A: minimalist. Observed refs, child items, and nothing else

Stance: express quick-fix, feature and research with fewer primitives than the baseline. Delete or generalise
before adding. Every primitive kept is used by at least two workflows. Feature counts as using quick-fix's
primitives because its slices and its final merge *are* quick-fix items.

Files beside this one (machine-checked, see section 7):
`quick-fix.json`, `feature.json`, `research.json` (the three workflows, exactly as in section 4),
`engine/spec.js` (spec.js with the one interpreter change applied), `sim.mjs` (pure-transition run of every
scenario's event sequence through `machineOf`; prints `all ok`).

## 1. The core rules

1. **Context holds only two kinds of value: refs the host observed, and answers a person gave.** A ref is
   `{ url, at }`. For a GitHub PR, `at` is its head commit. For any other URL, `at` is a verbatim quote. An agent's
   result counts only after the host has checked every ref in it: the PR is at `at` on GitHub, *and the agent's own
   worktree is at `at`*, or the page at `url` contains `at`. The host also adds the facts it saw (`key`, `gates`,
   `green`). Fields an agent repeats from its input must equal that input. Everything else is refused at accept
   time and never reaches the item.
2. **Every gate is a guard over context that was observed, never claimed.** "Verified" means
   `verdict.pr.at same pr.at`. "Mine" means `event.pr same pr.key`. A merge needs a verified head, green CI on that
   head, and an approval: the person's, or a grant written as a literal by a parent workflow. An event that matches
   no candidate in the current state is refused, so late, foreign and stale events change nothing.
3. **Work that is bigger than one PR is more items.** An invoke whose `src` names a workflow starts a child item.
   The child's id is the run's effect id, so it is deterministic and created exclusively. The child's final
   `output` comes back as the invoke's `done` event. A state may hold a list of invokes, which runs them in
   parallel. The join is ordinary ordered candidates with `meta.needs`.
4. **An item runs on the workflow bytes it started with.** At start the workflow is pinned by its sha256. Restore
   and replay load that pinned copy, never the file as it is now.

## 2. Primitives

Baseline (pack): 25. This design: **22 primitives, 1 of them an interpreter change, so 23 weighted.**

| # | Kind | Primitive | Status | Used by |
|---|---|---|---|---|
| 1 | state kind | normal | kept | quick-fix, feature, research |
| 2 | state kind | final | kept | quick-fix, feature, research |
| 3 | transition kind | invoke onDone/onError, **one invoke or a list** | changed (spec.js, counts double) | all; list form in feature (3 slices) and research (3 researchers) |
| 4 | transition kind | on | kept | quick-fix, feature (through its quick-fix children) |
| 5 | transition kind | reenter | kept | all three (replanning asks again); quick-fix (re-verify after the head moves while verifying) |
| 6 | context op | set | kept | all |
| 7 | context op | inc | kept | quick-fix (builds), research (drafts) |
| 8 | guard form | present | kept | all |
| 9 | guard form | same | kept | quick-fix, feature (children) |
| 10 | guard form | in (one-element lists replace `is`) | kept | all |
| 11 | spec convention | meta.needs | kept | all |
| 12 | spec convention | meta.actors | kept | all |
| 13 | spec convention | meta.events | kept | quick-fix, feature (children); `{}` in feature and research |
| 14 | spec convention | meta.input | kept | all |
| 15 | effect type | run | kept | all |
| 16 | effect type | stop | kept | quick-fix (head moved under verify/ask), feature (children) |
| 17 | event shape | xstate.done/error.actor.* | kept | all |
| 18 | event shape | github.&lt;kind&gt; | kept, now the platform's real kinds: `check_suite.completed`, `check_run.completed`, `pull_request.closed` | quick-fix, feature (children) |
| 19 | handle form | ref `{ url, at }` (+ host-stamped `key`, `gates`, `green` on PR refs) | new (replaces the PR handle `{ branch, headSha, url }`) | quick-fix (pr, verdict.pr), feature (children), research (sources) |
| 20 | accept-time check | refs observed, restated inputs equal, stamped fields reserved | changed (generalises `github-fact` in actors.js) | quick-fix, research, feature (children) |
| 21 | cross-item relation | child item: an invoke `src` naming a workflow | new | feature (parent), quick-fix (child: its `output` is the return value) |
| 22 | load-time check | workflow pinned by sha256 at start | new (loader in index.js; see note) | all |
| - | transition kind | after | **removed** | - |
| - | effect type | timer, cancel | **removed** | - |
| - | event shape | timers (`xstate.after.*`), tripwire | **removed** | - |
| - | guard form | is, below | **removed** (`is` becomes `in: [x]`; `below: 2` becomes `in: [0, 1]`) | - |
| - | event shape | `pr.pushed` (host-made, no platform source) | **removed**: a push shows up as `check_suite.completed` at a new head | - |

`meta.guards`, `meta.schemas` and the root `output` mapping are uncounted plumbing, as they are in the baseline.
`meta.delays` goes away with `after`.

Interpreter changes, each counted double: **one**. `spec.js` `bindState` binds `invoke` when it is a list
(section 4.0). `host.js` is unchanged. The pin lives in the loader (`index.js` `loadWorkflow`, plus the two
callers that pick a workflow for an existing item: `bin/host.js` and `actors.js` `deliver`). If a judge counts
`bin/host.js` as "host.js", the weighted total is 24, still under 25.

### Last deletion pass

- **Deleted `below`.** `buildsLeft` and `draftsLeft` become `{ path, in: [0, 1] }`. All scenarios still hold, as
  sim.mjs re-run shows. It stays out.
- **Tried deleting `reenter`.** Q2 breaks: a new head while verifying must restart the verify run, and a
  self-target without `reenter` does not re-invoke. Kept.
- **Tried deleting `inc`.** It would need one literal-`set` candidate per round in every bounded loop: the spec
  grows and the bound becomes harder to read. That trade is not worth one primitive. Kept.
- **Tried deleting `stop`.** It is XState's own `stopChild`. A spec cannot avoid it, so removing it from the host
  would only hide it. Kept.
- **Tried deleting the child-item relation.** Feature then needs parallel regions (two new state kinds plus
  state-level `onDone`, which is an interpreter change) and three copies of quick-fix's states. Kept.

## 3. Context shapes

Every value is `null` until set. *Observed* marks values that came only through a host check. *Person* marks
values that came only from a card tap, or from a literal a parent workflow wrote.

### quick-fix

```json
{
  "issue":    { "url": "https://github.com/o/r/issues/7", "expect": ["line", "..."] },
  "why":      "the person's five whys from the last replan, or null",
  "base":     "branch the PR targets; null = default branch (a feature slice: the feature branch)",
  "branch":   "head branch to build on; null = the builder's own (feature's final child: the feature branch)",
  "grant":    { "choice": "approve", "by": "feature" },
  "decision": { "choice": "approve | reject | replan | drop", "by": "person id or 'feature'", "gates": ["..."] },
  "briefs":   { "builder": "text", "verifier": "text" },
  "pr":       { "url": "https://github.com/o/r/pull/1", "at": "<40-hex head>", "key": "o/r#1",
                "gates": [".github/workflows/ci.yml"], "green": true },
  "verdict":  { "result": "PASS | FAIL", "report": "text",
                "issue": { "url": "...", "expect": ["..."] },
                "pr": { "url": "...", "at": "<head the verifier's worktree was at>", "key": "o/r#1", "gates": ["..."] } },
  "failure":  { "check": "test", "conclusion": "failure", "sha": "<head>", "url": "details url" },
  "merge":    { "sha": "<merge commit>" },
  "builds":   0
}
```

`grant` and the initial `decision` come from input only. Top-level items leave both `null`. A feature slice gets
both as the same literal. Every reset of `decision` sets it to `context.grant`. `pr.key`, `pr.gates` and
`pr.green` are observed (stamped at accept). After that only GitHub events change `pr.at` and `pr.green`.
`failure` is one of: a check failure (as shown), `{ mergedOutside: "o/r#1" }`, or an actor's error string.

### feature

```json
{
  "issue":    { "url": "https://github.com/o/r/issues/9", "expect": ["the feature's acceptance lines"] },
  "branch":   "feature/9-multiply",
  "why":      null,
  "plan":     { "slices": [ { "url": ".../issues/9#s1", "expect": ["..."] }, { "...": "s2" }, { "...": "s3" } ] },
  "slices":   { "s1": "<quick-fix output: { issue, pr, verdict, merge }>", "s2": { "error": "if the child could not start" }, "s3": "..." },
  "final":    "<quick-fix output of the child that merges branch into main>",
  "decision": null,
  "failure":  null
}
```

### research

```json
{
  "issue":    { "url": "https://github.com/o/r/issues/11", "expect": ["what the answer must establish"] },
  "why":      null,
  "plan":     { "questions": ["q1", "q2", "q3"], "researcher": "brief", "writer": "brief", "verifier": "brief" },
  "answers":  { "q1": { "text": "...", "sources": [ { "url": "https://...", "at": "verbatim quote" } ] },
                "q2": { "...": "..." },
                "q3": { "error": "the worker failed" } },
  "draft":    { "text": "report", "sources": [ { "url": "...", "at": "quote" } ] },
  "verdict":  { "result": "PASS | FAIL", "issue": { "...": "restated" }, "report": "...", "sources": [ { "url": "...", "at": "..." } ] },
  "decision": { "choice": "approve", "by": "person" },
  "post":     { "ref": "cmsg_..." },
  "failure":  null,
  "drafts":   0
}
```

## 4. States and transitions

The three workflows are in the spec's own format, unchanged except for an `invoke` that may be a list. The full
JSON is in 4.5 to 4.7 and in the files beside this doc. Their pretty-printed sizes (`JSON.stringify(x, null, 2)`)
are: quick-fix 1171 lines, research 778, feature 542, **2491 in total** (the baseline quick-fix is 799). Quick-fix
is large because four waiting states each repeat the same three GitHub handlers. A compound state would remove
that repetition but costs a state kind, and that is the wrong trade under this scoring.

### 4.0 The interpreter change (spec.js, the only one)

In `bindState`, replace the `if (state.invoke) { ... }` block with:

```js
if (state.invoke) {
  const one = (invoke) => {
    const { input = {}, onDone, onError } = invoke;
    const b = { ...invoke, input: (scope) => mapPaths(input, scope) };
    if (onDone) b.onDone = bind(onDone);
    if (onError) b.onError = bind(onError);
    return b;
  };
  bound.invoke = Array.isArray(state.invoke) ? state.invoke.map(one) : one(state.invoke);
}
```

Nothing else changes in spec.js or host.js. XState emits one `xstate.spawnChild` per invoke, so host.js already
makes one run effect per invoke, `<item>:<seq>.<invoke id>`. A finished invoke's `done` or `error` closes only
its own run. Leaving the state stops whichever runs are still open (`stop`). A targetless candidate (no
`target`) keeps the state and its other invokes, and bindTransition already checks it against the state's own
needs. `engine/spec.js` beside this doc is the patched file.

The removed primitives need no code. The specs no longer use `after`, timers, tripwire or `is`/`below`.
host.js's timer branches and spec.js's `is`/`below` branches go dormant and can be deleted in a follow-up; no
behaviour depends on them. Ported parity cases that drive `pr.pushed`, tripwire or timers are rewritten to the
events above, or retired along with the primitive.

### 4.1 Accept-time check (actors.js `accept`, replaces `claimedPrs` and the `github-fact` loop)

After the existing caller, already-returned and schema checks, and before `result.json` is written:

1. **Reserved.** If any ref in the result (any object with string `url` and string `at`, at any depth) carries
   `key`, `gates` or `green`, refuse with rule `reserved`.
2. **Restated inputs.** For every top-level key `k` of the result that is also a key of `run.input`, refuse with
   rule `restated` unless `JSON.stringify(result[k]) === JSON.stringify(run.input[k])`. This is why the input keys
   are `previous` (build) and `target` (verify) and never `pr`, and why verify's output must restate `issue`.
3. **Refs.** For each ref, depth-first:
   - If `prRef(url)` parses (a GitHub PR):
     - `github.pull(ref).head.sha === at`, else refuse `ref` ("GitHub shows <url> at <x>, not <at>").
     - `git -C <run.worktree> rev-parse HEAD === at`, else refuse `ref` ("your worktree is at <y>, not <at>").
     - Stamp `key = "<owner>/<repo>#<n>"`.
     - Stamp `gates` = the filenames from `github.files(ref)` (`GET /repos/{o}/{r}/pulls/{n}/files`) that start
       with `.github/`, only when there are any.
     - Stamp `green = true` when `github.suites({ owner, repo, sha: at })`
       (`GET /repos/{o}/{r}/commits/{at}/check-suites`) has at least one suite, all `completed`, none with a
       conclusion outside `success | neutral | skipped`.
   - Otherwise, `web.get(url)` must return 2xx with a body that contains `at` (after collapsing whitespace), else
     refuse `ref` ("the page at <url> does not contain the quoted text").
4. Store and journal the **stamped** result. `result.stored` hashes the stamped JSON, and `resultsOf` delivers it.

`accept` gains a `web` client (`{ get(url) -> { status, body } }`). The github client gains `files` and `suites`
in `effects/github.js`, using the same REST plumbing. A refusal is journalled as `refusal` with its rule, as it is
today, and the agent may return again.

### 4.2 Child items (new `packages/engine/src/effects/item.js`, registered in `effects/index.js`)

```js
// handlers({ ..., workflows: { 'quick-fix': true }, root, session, release, actorsFor })
// byActor[name] = item({ ... }) for every workflow name in `workflows`.
export const item = ({ root, session, release, load, handlersFor }) => ({
  async start(effect) {                       // effect.actor is the workflow name, effect.id the child item id
    const child = effect.id;
    const spec = workflowOf(root, child) ?? load(effect.actor, { root });   // pinned (4.3)
    const host = restore({ root, item: child, spec, session, release });
    if (!host.snapshot) await offer(host, [{ event: { type: 'xstate.init', input: effect.input },
                                            source: { system: 'item', ref: effect.id } }], handlersFor(host));
    if (!host.snapshot) throw new Error(`child ${child} refused its input`);   // run fails -> parent's onError
    return { ref: child };                    // no output: the run stays open until the child is final
  },
  find: (effect) => (existsSync(itemFile(root, effect.id)) ? { ref: effect.id } : null)
});

// The done events of an item's finished children, for the caller to offer (as resultsOf does for agents).
export function childResults(host, load) {
  return [...host.runs.values()].filter((r) => isWorkflow(r.actor)).flatMap((run) => {
    const c = restore({ root: host.root, item: run.id, spec: workflowOf(host.root, run.id), session: host.session, release: host.release });
    return c.snapshot?.status === 'done'
      ? [{ event: { type: `xstate.done.actor.${run.invoke}`, output: c.snapshot.output }, run: run.id,
           source: { system: 'item', ref: `${run.id}#final` } }]
      : [];
  });
}

// After any offer to an item: if it is final and is a child (runOf(item) names a parent whose file exists),
// offer childResults(parent) to the parent and settle the parent in turn.
export async function settle({ root, item, ... }) { ... }

// The items a wake is offered to: the top item and, recursively, the children its open runs name.
export const openItems = (root, top) => ...;
```

Exclusive creation is already in `persist` (the seq-0 row opens the file with `wx`). Two starts of the same child,
by two hosts or by one host replaying a half-done effect, therefore produce one child. The second start hits
`OwnedError`. `offer` restores and the init is refused as "has started", so the handler returns the existing ref.
`runOf` already parses a child's own runs correctly (`f-1:2.s1:0.brief` gives item `f-1:2.s1`).

The driver (bin/host.js `wake`, and `deliver`) offers every wake's inputs to every item in `openItems`,
`resultsOf(host)` and `childResults(host)` to each, then calls `settle`. Agent-actor handlers are per host, so
`handlers()` takes `actorsFor(host)` (a function) and the item handler builds the child's handlers with it.

### 4.3 Workflow pin (index.js loader)

- `loadWorkflow(name, { root, dir })`:
  - If `name` is `<id>@<sha256>`, read `<root>/blobs/<sha256>`, check its hash, parse it and return it with that
    id.
  - Otherwise read `<dir ?? repo workflows>/<name>.json` as bytes, write them to `<root>/blobs/<sha256>` (when
    `root` is given), and return the parsed spec with `id: "<name>@<sha256>"`.
- `workflowOf(root, item)`: read the item's seq-0 `engine.transition` row and return
  `loadWorkflow(row.payload.workflow, { root })`, or `null` when the item has not started.
- Because `transitionRow` records `payload.workflow = host.spec.id`, every row carries the pinned id without
  touching host.js. `prepare` records the same id in `run.json`, so `deliver` loads the pinned spec.
- `bin/host.js` uses `workflowOf(root, item) ?? loadWorkflow(opts.workflow, { root })`. `hashOf` does not read
  `spec.id`, so replay hashes are unchanged.

### 4.4 Agent prompts (the helper agents' contract)

The prompts are where an agent learns the rules above, so they are part of the design and not left to chance.
Three parts change.

**a. `contextOf(run)` in actors.js** (sent to every agent at SubagentStart) gains these lines after the
return-tool line, for every actor:

```
Every reference you return is { "url", "at" }. For a pull request, at is its head commit, and your own worktree
must be checked out at exactly that commit when you return (git rev-parse HEAD is compared with at). For any other
page, at is a short verbatim quote that appears on that page. The host checks every reference before your result
counts, and refuses the result naming the first one that fails; fix that reference and return again.
Never set key, gates or green on a reference: the host sets them from what it sees.
If your result has a field your input also has (such as issue), it must repeat the input's value exactly. Grade
and build against your input, never against the current text of the issue on GitHub.
```

For `verify` it adds `Check out target.at in your worktree before you test; your verdict counts only for
target.url at that commit.` For `build` it adds `Commit and push from your worktree; return the PR at the commit
you pushed.`

**b. Brief-writing actors get their task from the spec**, as a literal `task` input. `writtenBrief` already
serialises the input, so no host code knows a workflow's wording. The task text is in each workflow's `briefing`
or `planning` invoke (4.5 to 4.7). It tells the brief agent what to return, that briefs are fixed before any
build starts, that the verifier must be independent of the builder, and to grade only against the given
`expect` lines.

**c. `writtenBrief(actor, input)` becomes:**

```
You are the <actor> actor of a ccp_xstate work item. Your task: <input.task>. Your input (without the task) is
<JSON>. Return exactly what the task asks, through the harness return tool, matching the schema you are given.
```

Researchers, writers, builders and verifiers get their brief from `plan` or `briefs`, which the brief agent wrote
and the journal fixed (`brief.stored`) before they started.

### 4.5 quick-fix

```json
{
  "id": "quick-fix",
  "description": "One issue to one merged PR. Context holds only refs the host observed and answers the person gave; every gate is a same-guard between them.",
  "initial": "briefing",
  "context": {
    "issue": null, "why": null, "base": null, "branch": null, "grant": null, "decision": null,
    "briefs": null, "pr": null, "verdict": null, "failure": null, "merge": null, "builds": 0
  },
  "output": { "issue": "context.issue", "pr": "context.pr", "verdict": "context.verdict", "merge": "context.merge" },
  "states": {
    "briefing": {
      "meta": { "needs": ["hasIssue"] },
      "invoke": {
        "id": "brief", "src": "brief",
        "input": { "task": { "value": "Write two briefs for this issue before any build starts; they are fixed once returned. builder: how to make one PR that meets every line of issue.expect, opened against base (the default branch when base is null) from branch (a new branch when branch is null), committed and pushed from the builder's own worktree. verifier: how an independent verifier checks out the PR head in its own worktree and tests each expect line, reading neither the builder's notes nor the issue's current text on GitHub. Grade only against the expect lines given here." }, "issue": "context.issue", "why": "context.why", "base": "context.base", "branch": "context.branch" },
        "onDone": { "target": "building", "actions": [{ "type": "set", "params": { "briefs": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "building": {
      "meta": { "needs": ["hasBriefs", "buildsLeft"] },
      "invoke": {
        "id": "build", "src": "build",
        "input": { "issue": "context.issue", "brief": "context.briefs.builder", "base": "context.base", "branch": "context.branch", "previous": "context.pr", "verdict": "context.verdict", "failure": "context.failure" },
        "onDone": [
          { "target": "verifying", "description": "the host saw CI green on the claimed head at accept time", "actions": [{ "type": "set", "params": { "pr": "event.output.pr", "verdict": { "value": null }, "failure": { "value": null } } }, { "type": "inc", "params": "builds" }] },
          { "target": "checking", "actions": [{ "type": "set", "params": { "pr": "event.output.pr", "verdict": { "value": null }, "failure": { "value": null } } }, { "type": "inc", "params": "builds" }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "checking": {
      "meta": { "needs": ["hasBriefs", "hasPr"] },
      "on": {
        "github.check_suite.completed": { "target": "verifying", "guard": "mine", "description": "CI green on the PR at head_sha, which becomes the head to verify", "actions": [{ "type": "set", "params": { "pr.at": "event.head_sha", "pr.green": { "value": true } } }] },
        "github.check_run.completed": [
          { "target": "building", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] },
          { "target": "replanning", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "mergedOutside", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.mergedOutside": "event.pr" } }] }
      }
    },
    "verifying": {
      "meta": { "needs": ["hasBriefs", "hasPr", "ciGreen"] },
      "invoke": {
        "id": "verify", "src": "verify",
        "input": { "issue": "context.issue", "brief": "context.briefs.verifier", "target": "context.pr" },
        "onDone": [
          { "target": "awaitingGates", "description": "PASS at the head, and the PR changes CI config", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "merging", "description": "PASS at the head, and the parent granted the merge", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "awaitingMerge", "description": "PASS at the head", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "building", "guard": "failed", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "replanning", "description": "FAIL with no build left, or a verdict on another head", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      },
      "on": {
        "github.check_suite.completed": [
          { "guard": "sameHead", "description": "green again on the head being verified: nothing to do" },
          { "target": "verifying", "reenter": true, "guard": "mine", "description": "green on a new head: the head moved, verify it instead", "actions": [{ "type": "set", "params": { "pr.at": "event.head_sha", "pr.green": { "value": true }, "verdict": { "value": null } } }] }
        ],
        "github.check_run.completed": [
          { "target": "building", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] },
          { "target": "replanning", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "mergedOutside", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.mergedOutside": "event.pr" } }] }
      }
    },
    "awaitingGates": {
      "meta": { "needs": ["verifiedHead", "gatesTouched"] },
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "This PR changes CI configuration, so its green CI is the builder's own. Merge it at the verified commit, CI change included?" }, "choices": { "value": ["approve CI change", "reject"] }, "pr": "context.verdict.pr", "verdict": "context.verdict" },
        "onDone": [
          { "target": "merging", "guard": "gatesApproved", "actions": [{ "type": "set", "params": { "decision": { "value": { "choice": "approve" } }, "decision.by": "event.output.by", "decision.gates": "context.verdict.pr.gates" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      },
      "on": {
        "github.check_suite.completed": [
          { "guard": "sameHead" },
          { "target": "verifying", "guard": "mine", "actions": [{ "type": "set", "params": { "pr.at": "event.head_sha", "pr.green": { "value": true }, "verdict": { "value": null } } }] }
        ],
        "github.check_run.completed": [
          { "target": "building", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] },
          { "target": "replanning", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "mergedOutside", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.mergedOutside": "event.pr" } }] }
      }
    },
    "awaitingMerge": {
      "meta": { "needs": ["verifiedHead"] },
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "Merge this PR at the verified commit?" }, "choices": { "value": ["approve", "reject"] }, "pr": "context.verdict.pr", "verdict": "context.verdict" },
        "onDone": [
          { "target": "merging", "description": "approved (merging needs approved)", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      },
      "on": {
        "github.check_suite.completed": [
          { "guard": "sameHead" },
          { "target": "verifying", "guard": "mine", "actions": [{ "type": "set", "params": { "pr.at": "event.head_sha", "pr.green": { "value": true }, "verdict": { "value": null } } }] }
        ],
        "github.check_run.completed": [
          { "target": "building", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] },
          { "target": "replanning", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "mergedOutside", "actions": [{ "type": "set", "params": { "failure": { "value": null }, "failure.mergedOutside": "event.pr" } }] }
      }
    },
    "merging": {
      "meta": { "needs": ["verifiedHead", "ciGreen", "approved"] },
      "invoke": {
        "id": "merge", "src": "merge",
        "input": { "pr": "context.pr", "sha": "context.verdict.pr.at" },
        "onDone": { "target": "done", "actions": [{ "type": "set", "params": { "merge": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error", "decision": "context.grant" } }] }
      }
    },
    "replanning": {
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "This item stalled. Replan it with a written five whys, or drop it?" }, "choices": { "value": ["replan", "drop"] }, "verdict": "context.verdict", "failure": "context.failure" },
        "onDone": [
          { "target": "briefing", "guard": "replan", "actions": [{ "type": "set", "params": { "why": "event.output.why", "builds": { "value": 0 }, "pr": { "value": null }, "verdict": { "value": null }, "failure": { "value": null }, "decision": "context.grant" } }] },
          { "target": "dropped", "guard": "drop", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "reenter": true, "description": "replan without a written why: ask again", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": "dropped"
      }
    },
    "done": { "type": "final", "meta": { "needs": ["isMerged"] } },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "hasIssue": ["context.issue.url", "context.issue.expect"],
      "hasBriefs": ["context.briefs.builder", "context.briefs.verifier"],
      "buildsLeft": [{ "path": "context.builds", "in": [0, 1] }],
      "hasPr": ["context.pr.url", "context.pr.at", "context.pr.key"],
      "ciGreen": [{ "path": "context.pr.green", "in": [true] }],
      "failed": [{ "path": "context.verdict.result", "in": ["FAIL"] }],
      "verifiedHead": [{ "path": "context.verdict.result", "in": ["PASS"] }, { "path": "context.verdict.pr.at", "same": "context.pr.at" }, { "path": "context.verdict.pr.url", "same": "context.pr.url" }],
      "gatesTouched": ["context.verdict.pr.gates"],
      "gatesApproved": [{ "path": "event.output.choice", "in": ["approve CI change"] }],
      "approved": [{ "path": "context.decision.choice", "in": ["approve"] }],
      "replan": [{ "path": "event.output.choice", "in": ["replan"] }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "in": ["drop"] }],
      "isMerged": ["context.merge.sha"],
      "mine": [{ "path": "event.pr", "same": "context.pr.key" }],
      "sameHead": [{ "path": "event.pr", "same": "context.pr.key" }, { "path": "event.head_sha", "same": "context.pr.at" }],
      "redOnHead": [{ "path": "event.pr", "same": "context.pr.key" }, { "path": "event.head_sha", "same": "context.pr.at" }, { "path": "event.conclusion", "in": ["failure", "timed_out", "cancelled", "action_required", "startup_failure"] }],
      "mergedOutside": [{ "path": "event.pr", "same": "context.pr.key" }, { "path": "event.outcome", "in": ["merged"] }]
    },
    "input": {
      "type": "object",
      "required": ["issue"],
      "properties": {
        "issue": { "$ref": "#issue" },
        "base": { "type": "string", "minLength": 1 },
        "branch": { "type": "string", "minLength": 1 },
        "grant": { "type": "object", "required": ["choice", "by"] },
        "decision": { "type": "object", "required": ["choice", "by"] }
      }
    },
    "events": {
      "github.check_suite.completed": { "type": "object", "required": ["head_sha", "pr"], "properties": { "head_sha": { "$ref": "#sha" }, "pr": { "type": "string", "minLength": 1 } } },
      "github.check_run.completed": { "type": "object", "required": ["check", "conclusion", "head_sha", "pr"], "properties": { "check": { "type": "string", "minLength": 1 }, "conclusion": { "type": "string" }, "head_sha": { "$ref": "#sha" }, "pr": { "type": "string", "minLength": 1 } } },
      "github.pull_request.closed": { "type": "object", "required": ["outcome", "pr"], "properties": { "outcome": { "type": "string" }, "pr": { "type": "string", "minLength": 1 } } }
    },
    "actors": {
      "brief": { "type": "object", "required": ["builder", "verifier"], "properties": { "builder": { "type": "string", "minLength": 1 }, "verifier": { "type": "string", "minLength": 1 } } },
      "build": { "type": "object", "required": ["pr"], "properties": { "pr": { "$ref": "#ref" } } },
      "verify": { "type": "object", "required": ["result", "pr", "issue", "report"], "properties": { "result": { "enum": ["PASS", "FAIL"] }, "pr": { "$ref": "#ref" }, "issue": { "$ref": "#issue" }, "report": { "type": "string", "minLength": 1 } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "merge": { "type": "object", "required": ["sha"], "properties": { "sha": { "$ref": "#sha" } } }
    },
    "schemas": {
      "sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
      "ref": { "type": "object", "required": ["url", "at"], "properties": { "url": { "type": "string", "minLength": 1 }, "at": { "type": "string", "minLength": 1 } } },
      "issue": { "type": "object", "required": ["url", "expect"], "properties": { "url": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } }
    }
  }
}
```

### 4.6 feature

```json
{
  "id": "feature",
  "description": "One goal, several PRs. Each slice is a quick-fix child item merging into the feature branch on the parent's grant; the feature itself reaches main as one more quick-fix child, verified against the whole goal, on one person tap.",
  "initial": "planning",
  "context": { "issue": null, "branch": null, "why": null, "plan": null, "slices": null, "final": null, "decision": null, "failure": null },
  "output": { "issue": "context.issue", "slices": "context.slices", "final": "context.final" },
  "states": {
    "planning": {
      "meta": { "needs": ["hasIssue", "hasBranch"] },
      "invoke": {
        "id": "brief", "src": "brief",
        "input": { "task": { "value": "Split issue (a goal, with acceptance lines in expect) into exactly three slices that can each be built, verified and merged into branch on their own, as slices: each slice is { url, expect } with url the goal's url plus #s1, #s2 or #s3. Together the slices' expect lines must cover the goal's. Create branch from the default branch if it does not exist. If slices from an earlier attempt are given, leave the merged ones' work alone and plan around it." }, "issue": "context.issue", "branch": "context.branch", "why": "context.why", "slices": "context.slices" },
        "onDone": { "target": "slicing", "actions": [{ "type": "set", "params": { "plan": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "slicing": {
      "meta": { "needs": ["hasPlan"] },
      "invoke": [
        {
          "id": "s1", "src": "quick-fix",
          "input": { "issue": "context.plan.slices.0", "base": "context.branch", "grant": { "value": { "choice": "approve", "by": "feature" } }, "decision": { "value": { "choice": "approve", "by": "feature" } } },
          "onDone": [
            { "target": "finishing", "actions": [{ "type": "set", "params": { "slices.s1": "event.output" } }] },
            { "actions": [{ "type": "set", "params": { "slices.s1": "event.output" } }] }
          ],
          "onError": [
            { "target": "finishing", "actions": [{ "type": "set", "params": { "slices.s1.error": "event.error" } }] },
            { "actions": [{ "type": "set", "params": { "slices.s1.error": "event.error" } }] }
          ]
        },
        {
          "id": "s2", "src": "quick-fix",
          "input": { "issue": "context.plan.slices.1", "base": "context.branch", "grant": { "value": { "choice": "approve", "by": "feature" } }, "decision": { "value": { "choice": "approve", "by": "feature" } } },
          "onDone": [
            { "target": "finishing", "actions": [{ "type": "set", "params": { "slices.s2": "event.output" } }] },
            { "actions": [{ "type": "set", "params": { "slices.s2": "event.output" } }] }
          ],
          "onError": [
            { "target": "finishing", "actions": [{ "type": "set", "params": { "slices.s2.error": "event.error" } }] },
            { "actions": [{ "type": "set", "params": { "slices.s2.error": "event.error" } }] }
          ]
        },
        {
          "id": "s3", "src": "quick-fix",
          "input": { "issue": "context.plan.slices.2", "base": "context.branch", "grant": { "value": { "choice": "approve", "by": "feature" } }, "decision": { "value": { "choice": "approve", "by": "feature" } } },
          "onDone": [
            { "target": "finishing", "actions": [{ "type": "set", "params": { "slices.s3": "event.output" } }] },
            { "actions": [{ "type": "set", "params": { "slices.s3": "event.output" } }] }
          ],
          "onError": [
            { "target": "finishing", "actions": [{ "type": "set", "params": { "slices.s3.error": "event.error" } }] },
            { "actions": [{ "type": "set", "params": { "slices.s3.error": "event.error" } }] }
          ]
        }
      ]
    },
    "finishing": {
      "meta": { "needs": ["allEnded"] },
      "invoke": {
        "id": "final", "src": "quick-fix",
        "input": { "issue": "context.issue", "branch": "context.branch", "why": "context.why" },
        "onDone": [
          { "target": "done", "actions": [{ "type": "set", "params": { "final": "event.output" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "final": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "replanning": {
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "This feature stalled. Try again with a written five whys (the merged slices stay), or drop it?" }, "choices": { "value": ["replan", "drop"] }, "slices": "context.slices", "final": "context.final", "failure": "context.failure" },
        "onDone": [
          { "target": "finishing", "guard": "replan", "description": "the slices ran: finish on the feature branch with the why", "actions": [{ "type": "set", "params": { "why": "event.output.why", "final": { "value": null }, "failure": { "value": null } } }] },
          { "target": "planning", "guard": "replan", "description": "planning itself failed: plan again with the why", "actions": [{ "type": "set", "params": { "why": "event.output.why", "failure": { "value": null } } }] },
          { "target": "dropped", "guard": "drop", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "reenter": true, "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": "dropped"
      }
    },
    "done": { "type": "final", "meta": { "needs": ["isMerged"] } },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "hasIssue": ["context.issue.url", "context.issue.expect"],
      "hasBranch": ["context.branch"],
      "hasPlan": ["context.plan.slices"],
      "allEnded": ["context.slices.s1", "context.slices.s2", "context.slices.s3"],
      "replan": [{ "path": "event.output.choice", "in": ["replan"] }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "in": ["drop"] }],
      "isMerged": ["context.final.merge.sha"]
    },
    "input": { "type": "object", "required": ["issue", "branch"], "properties": { "issue": { "$ref": "#issue" }, "branch": { "type": "string", "minLength": 1 } } },
    "events": {},
    "actors": {
      "brief": { "type": "object", "required": ["slices"], "properties": { "slices": { "type": "array", "minItems": 3, "items": { "$ref": "#issue" } } } },
      "quick-fix": { "type": "object", "required": ["issue"], "properties": { "issue": { "$ref": "#issue" } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } }
    },
    "schemas": {
      "issue": { "type": "object", "required": ["url", "expect"], "properties": { "url": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } }
    }
  }
}
```

### 4.7 research

```json
{
  "id": "research",
  "description": "A question to a verified, published report. Three researchers run at once; the join waits for each to end, answered or failed; every source is a ref the host fetched.",
  "initial": "planning",
  "context": { "issue": null, "why": null, "plan": null, "answers": null, "draft": null, "verdict": null, "decision": null, "post": null, "failure": null, "drafts": 0 },
  "output": { "issue": "context.issue", "draft": "context.draft", "verdict": "context.verdict", "post": "context.post" },
  "states": {
    "planning": {
      "meta": { "needs": ["hasIssue"] },
      "invoke": {
        "id": "brief", "src": "brief",
        "input": { "task": { "value": "Split issue (a question, with the lines a good answer must meet in expect) into exactly three sub-questions answerable from public sources, as questions. Write three briefs: researcher (answer one sub-question; every claim cites a source as { url, at } where at is a short verbatim quote from that page), writer (combine the answers into one report meeting every expect line, citing only sources as { url, at }), verifier (check the report independently against every expect line and against its sources; restate issue exactly; PASS only if every line holds)." }, "issue": "context.issue", "why": "context.why" },
        "onDone": { "target": "researching", "actions": [{ "type": "set", "params": { "plan": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "researching": {
      "meta": { "needs": ["hasPlan"] },
      "invoke": [
        {
          "id": "q1", "src": "build",
          "input": { "question": "context.plan.questions.0", "brief": "context.plan.researcher" },
          "onDone": [
            { "target": "writing", "actions": [{ "type": "set", "params": { "answers.q1": "event.output" } }] },
            { "actions": [{ "type": "set", "params": { "answers.q1": "event.output" } }] }
          ],
          "onError": [
            { "target": "writing", "actions": [{ "type": "set", "params": { "answers.q1.error": "event.error" } }] },
            { "actions": [{ "type": "set", "params": { "answers.q1.error": "event.error" } }] }
          ]
        },
        {
          "id": "q2", "src": "build",
          "input": { "question": "context.plan.questions.1", "brief": "context.plan.researcher" },
          "onDone": [
            { "target": "writing", "actions": [{ "type": "set", "params": { "answers.q2": "event.output" } }] },
            { "actions": [{ "type": "set", "params": { "answers.q2": "event.output" } }] }
          ],
          "onError": [
            { "target": "writing", "actions": [{ "type": "set", "params": { "answers.q2.error": "event.error" } }] },
            { "actions": [{ "type": "set", "params": { "answers.q2.error": "event.error" } }] }
          ]
        },
        {
          "id": "q3", "src": "build",
          "input": { "question": "context.plan.questions.2", "brief": "context.plan.researcher" },
          "onDone": [
            { "target": "writing", "actions": [{ "type": "set", "params": { "answers.q3": "event.output" } }] },
            { "actions": [{ "type": "set", "params": { "answers.q3": "event.output" } }] }
          ],
          "onError": [
            { "target": "writing", "actions": [{ "type": "set", "params": { "answers.q3.error": "event.error" } }] },
            { "actions": [{ "type": "set", "params": { "answers.q3.error": "event.error" } }] }
          ]
        }
      ]
    },
    "writing": {
      "meta": { "needs": ["answered", "draftsLeft"] },
      "invoke": {
        "id": "write", "src": "build",
        "input": { "issue": "context.issue", "brief": "context.plan.writer", "answers": "context.answers", "verdict": "context.verdict" },
        "onDone": { "target": "verifying", "actions": [{ "type": "set", "params": { "draft": "event.output", "verdict": { "value": null } } }, { "type": "inc", "params": "drafts" }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "verifying": {
      "meta": { "needs": ["hasDraft"] },
      "invoke": {
        "id": "verify", "src": "verify",
        "input": { "issue": "context.issue", "brief": "context.plan.verifier", "draft": "context.draft", "answers": "context.answers" },
        "onDone": [
          { "target": "awaitingPublish", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "writing", "guard": "failed", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "awaitingPublish": {
      "meta": { "needs": ["passed"] },
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "Publish this verified report?" }, "choices": { "value": ["approve", "reject"] }, "draft": "context.draft", "verdict": "context.verdict" },
        "onDone": [
          { "target": "publishing", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "publishing": {
      "meta": { "needs": ["passed", "approved"] },
      "invoke": {
        "id": "post", "src": "post",
        "input": { "text": "context.draft.text", "sources": "context.draft.sources" },
        "onDone": { "target": "done", "actions": [{ "type": "set", "params": { "post": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "replanning": {
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "This research stalled. Replan it with a written five whys, or drop it?" }, "choices": { "value": ["replan", "drop"] }, "answers": "context.answers", "verdict": "context.verdict", "failure": "context.failure" },
        "onDone": [
          { "target": "planning", "guard": "replan", "actions": [{ "type": "set", "params": { "why": "event.output.why", "plan": { "value": null }, "answers": { "value": null }, "draft": { "value": null }, "verdict": { "value": null }, "decision": { "value": null }, "failure": { "value": null }, "drafts": { "value": 0 } } }] },
          { "target": "dropped", "guard": "drop", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "reenter": true, "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": "dropped"
      }
    },
    "done": { "type": "final", "meta": { "needs": ["isPosted"] } },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "hasIssue": ["context.issue.url", "context.issue.expect"],
      "hasPlan": ["context.plan.questions", "context.plan.researcher", "context.plan.writer", "context.plan.verifier"],
      "answered": ["context.answers.q1", "context.answers.q2", "context.answers.q3"],
      "draftsLeft": [{ "path": "context.drafts", "in": [0, 1] }],
      "hasDraft": ["context.draft.text", "context.draft.sources"],
      "failed": [{ "path": "context.verdict.result", "in": ["FAIL"] }],
      "passed": [{ "path": "context.verdict.result", "in": ["PASS"] }, "context.verdict.sources"],
      "approved": [{ "path": "context.decision.choice", "in": ["approve"] }],
      "replan": [{ "path": "event.output.choice", "in": ["replan"] }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "in": ["drop"] }],
      "isPosted": ["context.post.ref"]
    },
    "input": { "type": "object", "required": ["issue"], "properties": { "issue": { "$ref": "#issue" } } },
    "events": {},
    "actors": {
      "brief": {
        "type": "object", "required": ["questions", "researcher", "writer", "verifier"],
        "properties": { "questions": { "type": "array", "minItems": 3, "items": { "type": "string", "minLength": 1 } }, "researcher": { "type": "string", "minLength": 1 }, "writer": { "type": "string", "minLength": 1 }, "verifier": { "type": "string", "minLength": 1 } }
      },
      "build": { "type": "object", "required": ["text", "sources"], "properties": { "text": { "type": "string", "minLength": 1 }, "sources": { "type": "array", "minItems": 1, "items": { "$ref": "#ref" } } } },
      "verify": { "type": "object", "required": ["result", "issue", "report", "sources"], "properties": { "result": { "enum": ["PASS", "FAIL"] }, "issue": { "$ref": "#issue" }, "report": { "type": "string", "minLength": 1 }, "sources": { "type": "array", "items": { "$ref": "#ref" } } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "post": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string", "minLength": 1 } } }
    },
    "schemas": {
      "ref": { "type": "object", "required": ["url", "at"], "properties": { "url": { "type": "string", "minLength": 1 }, "at": { "type": "string", "minLength": 1 } } },
      "issue": { "type": "object", "required": ["url", "expect"], "properties": { "url": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } }
    }
  }
}
```

## 5. Scenarios: mechanism and test sequence

Tests go in `packages/engine/test/scenarios/<id>.test.js` and use `test/parity/world.js`, extended as follows:

- `fakeGitHub` also serves `GET /pulls/{n}/files` (per PR `files: []`) and `GET /commits/{sha}/check-suites`
  (per sha `suites`).
- A `web` stub `{ pages: { url: body } }`.
- `suite(head, n)`, `redRun(head, n)` and `closed(n)` wake builders over the three real fixtures in
  `test/fixtures/wakes/`.
- `child(root, id)` = `open(root, { item: id, spec: workflowOf(root, id) })`.

Where a scenario needs the accept-time check, the test drives real `actors()`, `spawn`/`bind`, `accept` and
`deliver` over `gitRepo()`, as `C-claimed-pr-not-on-github` does today. Otherwise stub agents return stamped
outputs. Every sequence below also runs as pure transitions in `sim.mjs`. Notation: `done(x, out)` is
`xstate.done.actor.x`; `tap(i)` is a decision-chosen wake on the open card.

| id | Mechanism | Test drives | Asserts |
|---|---|---|---|
| **Q1** | `building → checking → verifying → awaitingMerge → merging → done`. merging needs verifiedHead, ciGreen and approved; the merge effect uses `expectedHeadSha = verdict.pr.at`. | init; `done(brief)`; `done(build, {pr: ref A})`; `suite(A, 1)`; `done(verify, PASS at A, restated issue)`; `tap(0)` ("approve") | state `done`; `gh.merges == [{number: 1, sha: A}]`; **1 card tap** |
| **Q2** | A push shows up as `check_suite.completed` for the same PR at a new head. The `mine` candidate sets `pr.at = B` and `verdict = null` and goes to `verifying` (a new run). The old ask is stopped, so its tap matches no run. The new verifier's ref at A is refused at accept, because GitHub shows B. | Q1 up to awaitingMerge at A; `gh.push(1, B)`; `suite(B, 1)`; tap the old card; `done(verify, PASS at B)`; tap the new card | after the push: state `verifying`, `pr.at == B`, verify input `target.at == B`, old tap gives `[]`, `gh.merges == []`; finally `gh.merges == [{1, B}]`. Variant: tap approve before any suite event at B, so the merge effect is refused by GitHub (409), the state is `replanning`, and there is no merge. |
| **Q3** | `check_run.completed` red on `pr.at` of `pr.key`: first candidate goes to `building` (needs `builds in [0,1]`) with `failure = {check, conclusion, sha, url}`; second goes to `replanning`. | to `checking` at A; `redRun(A)` → assert `building` and the build run's input `failure.check == "test"`; `done(build, ref B)`; `redRun(B)` | the second red lands in `replanning`; no verify run starts for a red head |
| **Q4** | The verifier's PR ref is stamped `gates` from the PR's files (host-observed). The `verifying` onDone candidate 1 is `awaitingGates` (needs verifiedHead and gatesTouched). Its card is the only path, and its only approving choice is "approve CI change", which the onDone normalises to `decision.choice = "approve"` with `decision.gates`. A plain "approve" there goes to replanning. A slice's grant does not skip it, because candidate 1 comes first. | real accept: fake PR 1 with `files: ['.github/workflows/ci.yml']`; `suite(A)`; verify returns PASS at A, accepted with `gates` stamped | state `awaitingGates` (not merging, not awaitingMerge) after CI green; card choices `["approve CI change","reject"]`; `gh.merges == []`; `tap(0)` then merged at A. Second case: the same with input `grant` (slice) also stops at `awaitingGates`. |
| **Q5** | Accept compares the verifier's worktree `HEAD` with the PR ref's `at`. A mismatch is refused with rule `ref`, so nothing is delivered. Belt and braces: `verifiedHead` requires `verdict.pr.at same pr.at`. | real actors over `gitRepo()` (HEAD = X). Fake PR 1 head = A ≠ X. Verifier returns `{result: PASS, pr: {url, at: A}, issue, report}`. Then a control: fake PR head = X, verifier returns PASS at X. | first `accept` → `refused.rule == 'ref'` with reason naming worktree X, `resultsOf(host) == []`, state stays `verifying`, refusal journalled; the control is accepted and moves to `awaitingMerge` |
| **Q6** | Attempt 2 builds a new PR (replan sets `pr = null`; the build input `previous` is null). Every GitHub candidate requires `event.pr same pr.key`, so events about attempt 1's PR match nothing and are refused. Attempt 1's late `return` is stale (its run is not in flight). | verify FAIL ×2 → replanning; `tap` replan with why; brief; `done(build, ref B on PR 2)`; then `suite(C, 1)`, `redRun(C, 1)`, `closed(1)`, plus attempt 1's build run returning; then `suite(B, 2)`; verify PASS at B; tap | each attempt-1 input → outcome `refused` or `stale`; `pr.key == 'o/r#2'`; `gh.merges == [{2, B}]` |
| **Q7** | `github.pull_request.closed {outcome: merged}` for `pr.key` in checking, verifying, awaitingGates or awaitingMerge → `replanning` with `failure.mergedOutside`. `done` needs `merge.sha`, which only the merge effect's output sets. | to `awaitingMerge`; `closed(1)`; `tap` "drop" | state `replanning` and then `dropped`, never `done`; no merge effect row; `journal-check --host` lists #1 as merged outside the host (existing check) |
| **Q8** | Pin (4.3): the item's rows carry `quick-fix@<sha>`, and restore loads that blob. | write v1 to a temp workflows dir; start; reach `awaitingMerge`; overwrite the file with v2 (a changed question and an extra state); new process: `restore` with `workflowOf(root, item)`; tap approve | restore succeeds and replays every row's hash; the merge happens; card question is v1's; restoring with v2 directly throws "the workflow changed" |
| **Q9** | `expect` lives only in context from the init input. `github.issues.*` is not in `meta.events`, so it is refused. Verify gets `issue` from context and must restate it exactly (rule `restated`). Only a replan by the person changes what is graded. | during `building`, offer `{type: 'github.issues.edited', ...}`; then real verify returns PASS restating the edited expect → refused; returns the original → accepted | the edit is refused ("not an event quick-fix takes"); the verify run's input `issue.expect` equals the original; refusal rule `restated`; the verdict counts only with the original lines |
| **F1** | Parent `slicing` invokes three quick-fix children in parallel, each with `base = branch` and `grant = decision = approve by feature`, so each slice merges into the feature branch without a tap. Rounds per slice are bounded by the child's `builds in [0,1]`. A slice that keeps failing escalates on its own replanning card. The join is `allEnded`, and then `finishing` runs one more quick-fix child on `branch` against the **whole feature's `expect`**, which is the only merge to main and needs one tap. Merged slices are never reverted: `slices.s1` stays in context and on the branch. | feature init `{issue, branch}`; `done(brief, 3 slices)`. **s1:** brief, build, suite, verify PASS → merged into branch, no card. **s2:** build, suite, verify FAIL, build, suite, verify FAIL → child replanning card; tap "drop" → child `dropped`, `settle` → parent `slices.s2` set. **s3:** like s1. Join → `finishing`. Final child: brief, build (PR branch→main), suite, verify PASS against the feature's `expect`, tap approve. | s2 had exactly 2 build runs and 2 verify runs; parent reached `finishing` only after all three ended; `slices.s1.merge.sha` set and unchanged; only one merge to main (the final child's), at its verified head, after its PASS; taps on the merge path = **1** (2 overall, counting s2's escalation) |
| **F2** | The child's id is the run effect id, and its seq-0 row is created exclusively. A restored parent finds its open runs' children (`find`) instead of starting them, and a racing start hits `OwnedError`. Ownership stops another session acting at all. | parent to `slicing` with stub agents that leave the children's build runs open; then (a) new process, same session: `restore(parent)`, `offer(host, [])`, `childResults`, `settle`; (b) journal an effect `start` row with no end for s2 (crash mid-start), restore, `offer([])`; (c) another session restores and offers a wake | each `items/<parent>:<seq>.sN.jsonl` has exactly one seq-0 row; `agents.started` has one brief run per slice; in (b), `find` returned the existing child (no new init row); (c) gives `not-owner` and starts nothing |
| **R1** | `researching` invokes three `build` researchers in parallel. Each `done` or `error` sets `answers.qN`, and the candidate into `writing` needs all three present, so an error counts as ended and the join cannot hang. Every source the writer and the verifier cite is a ref whose quote the host fetched (accept). `publishing` needs `passed` and `approved`. | init; `done(brief, plan)`; q1 done; q3 error (task-notification wake "failed"); q2 done → `writing`. Writer returns sources with one quote absent from the web stub → refused; fixed → accepted. Verify PASS (restated issue, sources checked) → `awaitingPublish`. | no hang (state `writing` after the third run ends); `answers.q3.error` set; writer refusal rule `ref`; `plat.posts == []` until `tap(0)`; then `done` with one post; **1 tap** |

Person taps: **Q1 = 1, F1 = 1** for the feature's merge (plus 1 per escalated slice), **R1 = 1**.

## 6. Left out on purpose

- **Timeouts, reminders and tripwires** (`after`, `timer`, `cancel`, `tripwire`). An agent run always ends in
  `done` or `error`, because the harness fails a run whose agent stops without returning (`stopped`,
  `handback`). Rounds are bounded by `builds`. A card waiting on a person waits, and nudging is a platform
  concern. Cost: no stall alarm (`C-waiting-does-not-stall` stays a gap). Adding it back means returning `after`
  and the two timer effects, three primitives.
- **Dynamic fan-out.** Feature and research fan out to exactly three. That is the spec's width, and the brief
  schema requires at least three (`schema.js` has no `maxItems`; extras are ignored). Data-driven width needs an
  "invoke each" interpreter feature. Wider work is more items: a slice can itself be a feature.
- **Sequential slices.** Slices run in parallel into the feature branch. A slice that conflicts gets a merge
  refusal from GitHub and escalates through its own replanning. The final child verifies the whole goal, so
  ordering mistakes cannot reach main unverified.
- **Compound and parallel states, `always`, `#id` targets.** All are avoidable with ordered candidates and child
  items. Their cost is spec repetition in quick-fix's four waiting states, which is the tie-breaker and not the
  headline.
- **Re-planning slices.** A failed feature replans into `finishing` (the finisher builds the rest on the branch
  with the person's why), and into `planning` only when planning itself failed. Re-running merged slices would
  need conditional invokes.
- **Takeover by another session.** Ownership is unchanged: a different session's host acts on nothing. F2 is met
  by deterministic, exclusive child ids, which would still hold if takeover were added.
- **A configurable list of protected paths.** "Gates" are `.github/` only, a host constant. Making it per workflow
  would be a new `meta` key used by one workflow.
- **Red CI on a head other than the current one.** It is ignored on purpose. A late red for an old head must not
  undo a newer head. A push that goes red is seen when the builder or the next suite reports the new head.

## 7. Machine check

`sim.mjs` drives every sequence in section 5 as pure XState transitions through the patched `machineOf`. Host
concerns are left out: stale runs, schema refusals, accept, and effects. It needs `xstate` 5.x resolvable (run it
from a folder with `node_modules`, for example after copying it into the repo's scratch). Last output:

```
Q1 briefing > building > checking > verifying > awaitingMerge > merging > done
Q2 ... check_suite.completed at B: awaitingMerge > verifying (ask stopped, verify spawned) > awaitingMerge > merging
Q6 refused: check_suite(PR1), check_run(PR1), pull_request.closed(PR1) in checking; check_suite(PR1) in awaitingMerge
R1 planning > researching (spawned q1,q2,q3) > researching > researching > writing > verifying > awaitingPublish > publishing > done
F1 planning > slicing (spawned s1,s2,s3) > slicing > slicing > finishing > done
all ok
```
