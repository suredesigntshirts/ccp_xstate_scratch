# Design C: provenance (attestations with subjects)

Stance: supply-chain provenance (SLSA, in-toto, Bazel/Nix). A work item is a build pipeline. Every step's output is an
**attestation**: a predicate (what the worker says) plus a subject digest and facts the **host measured itself**. A
gate opens only when the attestations it needs name the same subject. The `done` state's needs work like an in-toto
layout: they are checked over the whole chain at the end. Workers never write the subject.

Pack: `/mnt/project-files/design-tournament/pack.md` (frozen at ccp_xstate main 5633401). The three workflow files
below are also at `C-provenance/workflows/*.json`. Under `C-provenance/checks/` are the scripts I ran against a copy
of the engine with the one interpreter change applied (see "Checked so far" at the end).

---

## 1. The core rules

1. **Context holds attestations, not claims.** Agent output reaches the machine only after the host stamps it with
   `attested = { run, digest, subject, prs, sources }`. The host writes this. A result that already carries an
   `attested` key is refused. Specs read facts from `attested.*` (for example `pr = event.output.attested.prs.0`) and
   never from what the worker claims.
2. **Every run has a subject the host materializes and measures again.** In a run's input, `subject` is a content
   address: a 40-hex commit is checked out detached, and a 64-hex blob digest is written to `.ccp/subject`. When the
   run returns, the host measures the worktree again (`git rev-parse HEAD`, or sha256 of `.ccp/subject`) and stamps
   that value. A verdict counts only for what was actually in the verifier's worktree.
3. **Writes go on lanes the host names.** In a run's input, `lane` names the only branch the run may push:
   `ccp/<item>/<lane>`. `into` names the base: `ccp/<item>/<into>`, or the default branch when `into` is absent. At
   accept, a claimed PR must be on that head branch and that base, as GitHub reports them. The merge effect checks the
   base again before it merges. A new attempt gets a new lane, so a dead attempt's PR is never the item's subject.
4. **Gates compare digests with `same`, and ordered candidates handle the "else".** No new guard forms are needed.
   Negation is fall-through (`is: null`, or a targetless first candidate). A disjunction is two candidates.
5. **The rules are pinned by content.** A workflow loads as `<name>@<sha256 of its file>`, and its bytes go into
   `blobs/`. An item restores from the digest its first journal row names, never from the file on disk.

That is the whole design. Each scenario below is one or more of these rules plus states that already exist.

---

## 2. Primitives (in the pack's kinds), compared with the baseline

| # | Kind | Primitive | Status | Used by |
|---|---|---|---|---|
| 1 | state kind | normal (including compound nesting, which spec.js already recurses) | kept | QF, F, R |
| 2 | state kind | final | kept | QF, F, R |
| 3 | state kind | **parallel** (XState `type: "parallel"`, passed through untouched) | **new** | R |
| 4 | transition kind | invoke onDone / onError | kept | QF, F, R |
| 5 | transition kind | on (including targetless, used as "consume and stay") | kept | QF, F, R |
| 6 | transition kind | after | kept | QF, F, R |
| 7 | transition kind | reenter | kept | QF, F, R (replan without a why asks again) |
| 8 | transition kind | **state-level onDone (join), bound with needs** | **new, interpreter change (counts ×2)** | QF, F (`gated`), R (`researching`) |
| 9 | context op | set | kept | QF, F, R |
| 10 | context op | inc | kept | QF, F, R |
| 11–15 | guard form | present, is (including `is: null`), in, same, below | kept | QF, F, R (`in` is used only by QF and F) |
| 16 | spec convention | meta.needs | kept | QF, F, R |
| 17 | spec convention | meta.actors / meta.events / meta.input (schemas) | kept (counted as 3) | QF, F, R |
| 18 | spec convention | **`input.subject`**: a content address the host materializes, then measures again at accept | **new** | QF, F, R |
| 19 | spec convention | **`input.lane` / `input.into`**: the head and base branches the host names | **new** | QF, F |
| 20 | accept-time check | **attest**: stamps `attested{run,digest,subject,prs,sources}`, refuses a worker-written `attested`, a PR off its lane or base, and a source whose quote isn't on the page the host fetched | **changed** (was: "a claimed PR is on GitHub at the claimed head") | QF, F, R |
| 21 | load-time check | **workflow pinned by digest** (`id = name@sha256`, bytes in `blobs/`, restore from the first row's id) | **new** | QF, F, R |
| 22 | effect type | run: prepare honours subject and lane; any declared actor that isn't a host effect is an agent; the merge handler checks `into` and outputs `head` | **changed** | QF, F, R |
| 23 | effect type | stop, timer, cancel | kept | QF, F, R |
| 24 | event shape | xstate.done/error.actor.*, timer events | kept | QF, F, R |
| 25 | event shape | github.<kind>: `check_run.completed` (kept), plus `check_suite.completed`, `pull_request.synchronize` and `pull_request.closed` declared in meta.events. No change to wake.js, which already maps any kind | kept (shape) | QF, F |
| – | event shape | `tripwire` | **removed** (rounds are bounded by `builds` and `rounds` counters. derive.js still writes the row as a health signal) | – |
| – | event shape | `pr.pushed` (no source, no PR) | **removed** (replaced by `github.pull_request.synchronize`) | – |
| – | cross-item relation | none | – | – |
| – | handle form | none new. Handles are attestations: `pr.ref` (`owner/repo#n`), `pr.head`, `report.attested.digest` | – | – |

**Interpreter changes: one** (row 8). No host.js changes. Everything else lives in `actors.js`, a new `attest.js`,
`effects/merge.js`, `effects/github.js` and `index.js`.

**Deleting primitives (done before finishing):**
- `meta.protected` is deleted. I first had a spec key listing CI paths. The scenarios still hold with the list as
  attest's host configuration (`protectedPaths`, default `[".github/"]`). It isn't workflow-specific, so it stays
  out of the specs.
- `into` is no longer a separate primitive. It was a separate "base branch" convention, and it is the same naming
  rule as `lane`, so the two are one primitive.
- `parallel` is no longer used in quick-fix and feature. They first gated verify and CI as two parallel regions.
  Recording every `check_suite.completed` at the root (a targetless set) and adding a `waitingCi` state removes the
  need. Parallel stays only where R1 says "parallel".
- I tried deleting `subject` and kept it. Without it, Q5 still holds if HEAD is always measured, but R1's verifier
  can't read the sources the host fetched, because agent file tools are confined to the worktree.
- I tried deleting state-level onDone and kept it. Without it, R1's join is impossible, and quick-fix needs every
  gate handler copied into four states.

---

## 3. Context shapes

### quick-fix
```json
{
  "issue":    { "url": "https://github.com/o/r/issues/7", "expect": ["…"] },
  "why":      null,
  "briefs":   { "builder": "…", "verifier": "…" },
  "attempt":  1,
  "builds":   0,
  "pr":       { "ref": "o/r#1", "url": "https://github.com/o/r/pull/1", "head": "<sha40>", "base": "main", "branch": "ccp/it-1/1", "protected": null },
  "verdict":  { "result": "PASS", "report": "…", "attested": { "run": "it-1:3.verify", "digest": "<sha256>", "subject": "<sha40 the host read from the verifier's worktree>", "prs": [], "sources": [] } },
  "ci":       { "head": "<sha40>", "pr": "o/r#1" },
  "decision": { "choice": "approve", "by": "<account>" },
  "merge":    { "sha": "<merge commit>", "head": "<sha40 merged>" },
  "failure":  { "kind": "check|moved|merged-outside|timeout|ci-timeout", "...": "typed fields" }
}
```
`pr` is `attested.prs[0]` exactly as the host read it from GitHub. `protected` is `null` or the list of changed
paths under the protected prefixes.

### feature
```json
{
  "issue": { "url": "…", "expect": ["the feature's acceptance lines"] },
  "why": null,
  "briefs": { "builder": "…", "verifier": "…", "slices": ["slice 0 …", "slice 1 …", "slice 2 …"], "count": 3 },
  "cursor": { "slice": 0, "attempt": 1 },
  "builds": 0,
  "pr": "same shape as quick-fix (a slice PR into ccp/<item>/feature, then the integration PR into main)",
  "verdict": "same shape as quick-fix",
  "ci": "same shape as quick-fix",
  "decision": null, "merge": { "sha": "…", "head": "…" }, "failure": null
}
```
Slice lane: `ccp/<item>/slice-<n>-attempt-<k>` (from `lane: context.cursor`). Feature lane: `ccp/<item>/feature`.

### research
```json
{
  "question": { "text": "…", "expect": ["what the report must establish"] },
  "why": null,
  "briefs": { "q1": "…", "q2": "…", "q3": "…", "synthesizer": "…", "verifier": "…" },
  "rounds": 0,
  "answers": { "q1": { "answer": "…", "sources": [{ "url": "…", "quote": "…" }], "attested": { "run": "…", "digest": "…", "sources": [{ "url": "…", "quote": "…", "digest": "<sha256 of the body the host fetched>" }] } }, "q2": null, "q3": null },
  "errors":  { "q1": null, "q2": "the worker failed", "q3": null },
  "report":  { "report": "<markdown>", "sources": [], "attested": { "run": "…", "digest": "<sha256 of the result blob>", "sources": [{ "url": "…", "quote": "…", "digest": "…" }] } },
  "verdict": { "result": "PASS", "report": "…", "attested": { "subject": "<= report.attested.digest>" } },
  "decision": { "choice": "publish", "by": "…" },
  "published": { "ref": "cmsg_…" },
  "failure": null
}
```

---

## 4. Workflows (spec format, with one interpreter change)

### 4.0 The interpreter change (spec.js, the only one)

In `bindState`, bind a state's own `onDone` the way invoke transitions are bound, so its candidates check their own
guard plus the target's needs against the context as their actions leave it:

```js
  if (state.onDone) bound.onDone = bind(state.onDone);   // new: join of a compound/parallel state
  if (state.states) { … unchanged … }
```

Targets resolve among the state's siblings, as XState does for state-level `onDone`. `type: "parallel"` and regions
pass through unchanged. `bindState` already recurses into `states` with the region's own states as siblings. host.js
needs nothing: parallel invokes become separate run effects (`<item>:<seq>.r1`, `.r2`, `.r3`), each region's
`after` timer has its own id, and replay hashes the object `value`. Checked with a copy of the host (section 7).
Update the header comment of spec.js ("four small conventions") to name state-level onDone.

### 4.1 Code outside the interpreter (exact)

**`packages/engine/src/attest.js` (new):**
```js
export const lanePart = (v) => (v && typeof v === 'object') ? Object.entries(v).map(([k, x]) => `${k}-${x}`).join('-') : String(v);
export const laneBranch = (item, lane) => `ccp/${safe(item)}/${lanePart(lane)}`;
export const intoBranch = (item, into, defaultBranch = 'main') => (into == null ? defaultBranch : laneBranch(item, into));

/** run: { run, actor, item, input, worktree, branch, into }; observe: { head(worktree), pull(ref), files(ref), fetch(url) }. */
export async function attest({ run, result, observe, protectedPaths = ['.github/'], store }) {
  if (result && typeof result === 'object' && 'attested' in result) return refused('attested-reserved', 'the host writes attested');
  const text = JSON.stringify(result);
  const digest = store(text);                                   // blobs/<sha256>, as accept already does
  const s = run.input?.subject;
  const subject = /^[0-9a-f]{40}$/.test(s ?? '') ? await observe.head(run.worktree)                  // git rev-parse HEAD
               : /^[0-9a-f]{64}$/.test(s ?? '') ? sha256(readFileOrNull(join(run.worktree, '.ccp/subject')))
               : null;
  const prs = [];
  for (const { path, pr } of claimedPrs(result)) {              // existing walker: objects with url + headSha
    const ref = prRef(pr.url); if (!ref) return refused('github-fact', `${path}.url is not a PR URL`);
    const now = await observe.pull(ref);                        // existing 404 / head checks stay
    if (now.head.sha !== pr.headSha) return refused('github-fact', `GitHub shows head ${now.head.sha}`);
    if (now.head.ref !== run.branch) return refused('lane', `PR is on ${now.head.ref}, this run's lane is ${run.branch}`);
    if (now.base.ref !== run.into)   return refused('lane', `PR is into ${now.base.ref}, this run may only open into ${run.into}`);
    const changed = (await observe.files(ref)).map((f) => f.filename);
    const hit = changed.filter((p) => protectedPaths.some((pre) => p.startsWith(pre)));
    prs.push({ ref: `${ref.owner}/${ref.repo}#${ref.pullNumber}`, url: pr.url, head: now.head.sha, base: now.base.ref,
               branch: now.head.ref, protected: hit.length ? hit : null });
  }
  const sources = [];
  for (const src of Array.isArray(result?.sources) ? result.sources : []) {
    const page = await observe.fetch(src.url);                  // host fetch, through the proxy like github.js
    if (!page || page.status < 200 || page.status > 299) return refused('source', `${src.url} answered ${page?.status}`);
    if (!norm(stripTags(page.body)).includes(norm(src.quote))) return refused('source', `quote not found at ${src.url}`);
    sources.push({ url: src.url, quote: src.quote, digest: store(page.body) });
  }
  return { output: { ...result, attested: { run: run.run, digest, subject, prs, sources } } };
}
```
`norm` collapses whitespace. `refused(rule, reason)` returns `{ refused: { rule, reason } }`.

**`actors.js`:**
- `accept()`: after the caller, bound-agent and already-returned checks, call `attest`. On refusal, journal it as
  today. Then check the actor schema on the **stamped** output, and write `{ result: stamped, hash: digest, … }` to
  `result.json`. The PR loop now in `accept()` moves into `attest`. `resultsOf` is unchanged, so done events carry
  `attested`.
- `prepare()`:
  - If `input.lane` is present: `branch = laneBranch(item, lane)` and `into = intoBranch(item, input.into)`. Run
    `git fetch origin`. If `input.into` is present and `origin/<into>` is missing, create it from the default branch
    with `git push origin origin/<default>:refs/heads/<into>`. The start point is `origin/<branch>` if it exists, else
    `origin/<into>`, else `origin/<default>`. Then `git worktree add -B <branch> <path> <start>`.
  - Else, if `input.subject` is 40-hex: `git fetch origin <sha>` (when missing), then `git worktree add --detach <path> <sha>`.
  - Else: as today. If `input.subject` is 64-hex, also write `blobs/<subject>` to `<worktree>/.ccp/subject`.
  - For every string under the input at a key named `digest`, write `blobs/<digest>` to `<worktree>/.ccp/blobs/<digest>`.
  - Record `branch` and `into` in run.json. A run with no lane keeps `run/<item>/<seq>.<invoke>`, and its `into` is
    the default branch.
- `AGENTS`: the actors in `spec.meta.actors` that are not host effects (`merge`, `ask`, `post`). This makes
  `research` and `synthesize` agents with no code naming them.
- `contextOf()`: the new agent prompt, in section 4.2.

**`effects/merge.js`:** before merging, `pull(ref)`. If `base.ref !== intoBranch(item, input.into)`, throw, which
becomes the item's onError. Output is `{ sha: <merge commit>, head: input.sha }`. `find()` also returns `head`.

**`effects/github.js`:** add `files(ref)` → `GET /repos/{o}/{r}/pulls/{n}/files?per_page=100` (paginated), and
`fetch(url)` → `{ status, body }` over the same proxy tunnel.

**`index.js` (the load-time pin):**
```js
export function pinWorkflow(root, name)   // read workflows/<name>.json bytes, d = sha256(bytes), write blobs/d,
                                          // return { ...JSON.parse(bytes), id: `${name}@${d}` }
export function pinnedWorkflow(root, item) // first engine.transition row with seq 0 → payload.workflow "name@d";
                                          // read blobs/d, refuse unless sha256(bytes) === d; return spec with that id
export function openItem({ root, item, workflow, session, release }) // pinned if the item's file exists, else pinWorkflow
```
`bin/host.js` and `deliver()` call `openItem` and `pinnedWorkflow` in place of `loadWorkflow`. `transitionRow`
already writes `workflow: host.spec.id`, so host.js is unchanged.

### 4.2 The agent prompts (what each helper agent is told)

The prompt is the brief exactly (hash-fixed, as today). `contextOf(run)` adds the lines below. Each line appears only
when its input key is present, so no line is specific to a workflow. Wording, in order:

1. `ccp-harness run <run> (item <item>, actor <actor>).`
2. **lane:** `Your worktree is <worktree>, on branch <branch>. Commit and push only to <branch>, and open or update
   exactly one pull request from <branch> into <into>. When you return, the host reads that pull request from GitHub:
   its head, base, branch and changed files are what count, not what you report.`
3. **subject, a commit:** `Your worktree is checked out at <sha>, the commit you are judging. Do not check out, pull,
   commit or reset anything. When you return, the host reads your worktree's HEAD, and your verdict counts only for
   that commit.`
4. **subject, a digest:** `What you are judging is the file .ccp/subject (sha256 <d>). The sources the host fetched are
   in .ccp/blobs/<digest>, listed in your input. Judge only against those files, and don't fetch other copies: a claim
   not supported by a file there is unsupported.`
5. **expect:** `Grade against the expect lines in your input exactly as given. They were fixed when the item was
   filed. Don't read them from the issue on GitHub, even if it now says something else.`
6. **sources** (the actor's schema has `sources`): `Cite every source as { "url", "quote" }, with the quote copied
   word for word from the page at url. The host fetches each url itself and refuses your result if a quote isn't on
   the page.`
7. **return:** `When you are done, call the harness return tool (its name ends in harness__return) with { "run":
   "<run>", "result": <your result> }. The result must match <schema minus attested>. Don't include an "attested"
   field: the host writes it, and a result that carries one is refused. Only the agent this run started may return.`
8. `Your input: <input JSON without brief, subject and lane, which are described above>`

**Independence of the verifier:** its input is `expect`, `briefs.verifier` (fixed by the brief run before any build)
and `subject`. It never gets the builder's report, verdict or failure.

### 4.3 quick-fix.json

```json
{
  "id": "quick-fix",
  "description": "Issue to one merged PR. Context holds only attestations: facts the host measured (attested.*) or the platform delivered (github.*, taps). Every gate compares subject digests; done's needs are the layout.",
  "initial": "briefing",
  "context": {
    "issue": null, "why": null, "briefs": null, "attempt": 1, "builds": 0,
    "pr": null, "verdict": null, "ci": null, "decision": null, "merge": null, "failure": null
  },
  "output": { "issue": "context.issue", "pr": "context.pr", "verdict": "context.verdict", "merge": "context.merge" },
  "on": {
    "github.check_suite.completed": { "description": "record every CI attestation; gates compare its head and pr", "actions": [{ "type": "set", "params": { "ci": { "value": null }, "ci.head": "event.head_sha", "ci.pr": "event.pr" } }] }
  },
  "states": {
    "briefing": {
      "meta": { "needs": ["hasIssue"] },
      "invoke": {
        "id": "brief", "src": "brief",
        "input": { "issue": "context.issue", "why": "context.why" },
        "onDone": { "target": "building", "actions": [{ "type": "set", "params": { "briefs": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "building": {
      "meta": { "needs": ["hasBriefs", "buildsLeft"] },
      "invoke": {
        "id": "build", "src": "build",
        "input": { "issue": "context.issue", "brief": "context.briefs.builder", "why": "context.why", "verdict": "context.verdict", "failure": "context.failure", "lane": "context.attempt" },
        "onDone": { "target": "gated", "actions": [
          { "type": "set", "params": { "pr": "event.output.attested.prs.0", "verdict": { "value": null }, "decision": { "value": null }, "failure": { "value": null } } },
          { "type": "inc", "params": "builds" }
        ] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      },
      "after": { "buildTimeout": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "timeout" } } } }] } }
    },
    "gated": {
      "meta": { "needs": ["hasPr"] },
      "initial": "verifying",
      "on": {
        "github.pull_request.synchronize": [
          { "guard": "sameHeadOnPr", "description": "the push the build already attested: nothing moved" },
          { "target": "building", "guard": "onPr", "description": "an unattested head: the current attempt's builder must own it", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "moved" } }, "failure.head": "event.head_sha" } }] },
          { "target": "replanning", "guard": "onPr", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "moved" } }, "failure.head": "event.head_sha" } }] }
        ],
        "github.check_run.completed": [
          { "target": "building", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "check" } }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] },
          { "target": "replanning", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "check" } }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] }
        ],
        "github.pull_request.closed": { "target": "replanning", "guard": "mergedOnPr", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "merged-outside" } }, "failure.pr": "event.pr" } }] }
      },
      "states": {
        "verifying": {
          "invoke": {
            "id": "verify", "src": "verify",
            "input": { "expect": "context.issue.expect", "brief": "context.briefs.verifier", "subject": "context.pr.head" },
            "onDone": [
              { "target": "awaitingCiApproval", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
              { "target": "awaitingMerge", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
              { "target": "waitingCi", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
              { "target": "out", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] }
            ],
            "onError": { "target": "out", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
          }
        },
        "waitingCi": {
          "meta": { "needs": ["verifiedHead"] },
          "on": {
            "github.check_suite.completed": [
              { "target": "awaitingCiApproval", "guard": "greenOnHead", "actions": [{ "type": "set", "params": { "ci.head": "event.head_sha", "ci.pr": "event.pr" } }] },
              { "target": "awaitingMerge", "guard": "greenOnHead", "actions": [{ "type": "set", "params": { "ci.head": "event.head_sha", "ci.pr": "event.pr" } }] }
            ]
          },
          "after": { "ciTimeout": { "target": "out", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "ci-timeout" } } } }] } }
        },
        "awaitingMerge": {
          "meta": { "needs": ["verifiedHead", "ciGreen", "ciUntouched"] },
          "invoke": {
            "id": "ask", "src": "ask",
            "input": { "question": { "value": "Merge this PR at the verified commit?" }, "choices": { "value": ["approve", "reject"] }, "pr": "context.pr", "verdict": "context.verdict" },
            "onDone": [
              { "target": "approved", "guard": "choseApprove", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
              { "target": "out", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
            ],
            "onError": { "target": "out", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
          }
        },
        "awaitingCiApproval": {
          "meta": { "needs": ["verifiedHead", "ciGreen", "ciTouched"] },
          "invoke": {
            "id": "ask", "src": "ask",
            "input": { "question": { "value": "This PR changes CI configuration, so its green CI ran on the changed config. Merge it at the verified commit anyway?" }, "choices": { "value": ["approve-ci-change", "reject"] }, "pr": "context.pr", "verdict": "context.verdict" },
            "onDone": [
              { "target": "approved", "guard": "choseApproveCiChange", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
              { "target": "out", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
            ],
            "onError": { "target": "out", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
          }
        },
        "approved": { "type": "final" },
        "out": { "type": "final" }
      },
      "onDone": [
        { "target": "merging", "guard": "approvedPlain" },
        { "target": "merging", "guard": "approvedCiChange" },
        { "target": "building", "guard": "failed" },
        { "target": "replanning" }
      ]
    },
    "merging": {
      "meta": { "needs": ["verifiedHead", "ciGreen"] },
      "invoke": {
        "id": "merge", "src": "merge",
        "input": { "pr": "context.pr", "sha": "context.pr.head" },
        "onDone": { "target": "done", "actions": [{ "type": "set", "params": { "merge": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "replanning": {
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "This item stalled. Replan it with a written five whys, or drop it?" }, "choices": { "value": ["replan", "drop"] }, "verdict": "context.verdict", "failure": "context.failure" },
        "onDone": [
          { "target": "briefing", "guard": "replan", "actions": [
            { "type": "set", "params": { "why": "event.output.why", "builds": { "value": 0 }, "pr": { "value": null }, "verdict": { "value": null }, "ci": { "value": null }, "decision": { "value": null }, "failure": { "value": null } } },
            { "type": "inc", "params": "attempt" }
          ] },
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
      "buildsLeft": [{ "path": "context.builds", "below": 2 }],
      "hasPr": ["context.pr.ref", "context.pr.head"],
      "verifiedHead": [{ "path": "context.verdict.result", "is": "PASS" }, { "path": "context.verdict.attested.subject", "same": "context.pr.head" }],
      "ciGreen": [{ "path": "context.ci.head", "same": "context.pr.head" }, { "path": "context.ci.pr", "same": "context.pr.ref" }],
      "ciUntouched": [{ "path": "context.pr.protected", "is": null }],
      "ciTouched": ["context.pr.protected"],
      "failed": [{ "path": "context.verdict.result", "is": "FAIL" }],
      "choseApprove": [{ "path": "event.output.choice", "is": "approve" }],
      "choseApproveCiChange": [{ "path": "event.output.choice", "is": "approve-ci-change" }],
      "approvedPlain": [{ "path": "context.decision.choice", "is": "approve" }, { "path": "context.pr.protected", "is": null }],
      "approvedCiChange": [{ "path": "context.decision.choice", "is": "approve-ci-change" }],
      "replan": [{ "path": "event.output.choice", "is": "replan" }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "is": "drop" }],
      "isMerged": ["context.merge.sha", { "path": "context.merge.head", "same": "context.verdict.attested.subject" }],
      "onPr": [{ "path": "event.pr", "same": "context.pr.ref" }],
      "sameHeadOnPr": [{ "path": "event.pr", "same": "context.pr.ref" }, { "path": "event.head_sha", "same": "context.pr.head" }],
      "greenOnHead": [{ "path": "event.pr", "same": "context.pr.ref" }, { "path": "event.head_sha", "same": "context.pr.head" }],
      "redOnHead": [{ "path": "event.conclusion", "in": ["failure", "timed_out"] }, { "path": "event.pr", "same": "context.pr.ref" }, { "path": "event.head_sha", "same": "context.pr.head" }],
      "mergedOnPr": [{ "path": "event.outcome", "is": "merged" }, { "path": "event.pr", "same": "context.pr.ref" }]
    },
    "delays": { "buildTimeout": 3600000, "ciTimeout": 3600000 },
    "input": {
      "type": "object", "required": ["issue"],
      "properties": { "issue": { "type": "object", "required": ["url", "expect"], "properties": { "url": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } } }
    },
    "events": {
      "github.check_suite.completed": { "type": "object", "required": ["head_sha", "pr"], "properties": { "head_sha": { "$ref": "#sha" }, "pr": { "type": "string" } } },
      "github.check_run.completed": { "type": "object", "required": ["check", "conclusion", "head_sha", "pr"], "properties": { "check": { "type": "string", "minLength": 1 }, "conclusion": { "type": "string" }, "head_sha": { "$ref": "#sha" }, "pr": { "type": "string" } } },
      "github.pull_request.synchronize": { "type": "object", "required": ["head_sha", "pr"], "properties": { "head_sha": { "$ref": "#sha" }, "pr": { "type": "string" } } },
      "github.pull_request.closed": { "type": "object", "required": ["outcome", "pr"], "properties": { "outcome": { "type": "string" }, "pr": { "type": "string" } } }
    },
    "actors": {
      "brief": { "type": "object", "required": ["builder", "verifier"], "properties": { "builder": { "type": "string", "minLength": 1 }, "verifier": { "type": "string", "minLength": 1 } } },
      "build": { "type": "object", "required": ["pr", "attested"], "properties": { "pr": { "type": "object", "required": ["url", "headSha"], "properties": { "url": { "type": "string" }, "headSha": { "$ref": "#sha" } } }, "attested": { "$ref": "#attested" } } },
      "verify": { "type": "object", "required": ["result", "report", "attested"], "properties": { "result": { "enum": ["PASS", "FAIL"] }, "report": { "type": "string", "minLength": 1 }, "attested": { "$ref": "#attested" } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "merge": { "type": "object", "required": ["sha", "head"], "properties": { "sha": { "$ref": "#sha" }, "head": { "$ref": "#sha" } } }
    },
    "schemas": {
      "sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
      "attested": { "type": "object", "required": ["run", "digest"], "properties": { "run": { "type": "string" }, "digest": { "type": "string", "pattern": "^[0-9a-f]{64}$" } } }
    }
  }
}
```

### 4.4 feature.json

Slices are verified, then merged by the host into the feature lane with no tap and no CI wait. CI may not run on PRs
into non-default branches, and the feature gate checks everything again. After the last slice, one integration PR
(feature lane → main) goes through the same `gated` compound as quick-fix: verified against the **feature's**
acceptance, CI green, and one tap.

```json
{
  "id": "feature",
  "description": "One goal, several slice PRs merged by the host into the item's feature lane, then one integration PR into the default branch, gated like quick-fix. Slices need no tap; the feature's merge needs one.",
  "initial": "briefing",
  "context": {
    "issue": null, "why": null, "briefs": null, "cursor": { "slice": 0, "attempt": 1 }, "builds": 0,
    "pr": null, "verdict": null, "ci": null, "decision": null, "merge": null, "failure": null
  },
  "output": { "issue": "context.issue", "pr": "context.pr", "verdict": "context.verdict", "merge": "context.merge" },
  "on": {
    "github.check_suite.completed": { "actions": [{ "type": "set", "params": { "ci": { "value": null }, "ci.head": "event.head_sha", "ci.pr": "event.pr" } }] }
  },
  "states": {
    "briefing": {
      "meta": { "needs": ["hasIssue"] },
      "invoke": {
        "id": "brief", "src": "brief",
        "input": { "issue": "context.issue", "why": "context.why" },
        "onDone": { "target": "building", "actions": [{ "type": "set", "params": { "briefs": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "building": {
      "meta": { "needs": ["hasBriefs", "buildsLeft"] },
      "invoke": {
        "id": "build", "src": "build",
        "input": { "issue": "context.issue", "brief": "context.briefs.builder", "plan": "context.briefs.slices", "slice": "context.cursor.slice", "why": "context.why", "verdict": "context.verdict", "failure": "context.failure", "lane": "context.cursor", "into": { "value": "feature" } },
        "onDone": { "target": "verifying", "actions": [
          { "type": "set", "params": { "pr": "event.output.attested.prs.0", "verdict": { "value": null }, "failure": { "value": null } } },
          { "type": "inc", "params": "builds" }
        ] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      },
      "after": { "buildTimeout": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "timeout" } } } }] } }
    },
    "verifying": {
      "meta": { "needs": ["hasPr"] },
      "invoke": {
        "id": "verify", "src": "verify",
        "input": { "brief": "context.briefs.verifier", "plan": "context.briefs.slices", "slice": "context.cursor.slice", "subject": "context.pr.head" },
        "onDone": [
          { "target": "sliceMerging", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "building", "guard": "failed", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "sliceMerging": {
      "meta": { "needs": ["verifiedHead"] },
      "invoke": {
        "id": "merge", "src": "merge",
        "input": { "pr": "context.pr", "sha": "context.pr.head", "into": { "value": "feature" } },
        "onDone": [
          { "target": "integrating", "description": "that was the last slice", "actions": [
            { "type": "set", "params": { "merge": "event.output", "builds": { "value": 0 }, "pr": { "value": null }, "verdict": { "value": null } } },
            { "type": "inc", "params": "cursor.slice" }
          ] },
          { "target": "building", "description": "the next slice, on its own lane", "actions": [
            { "type": "set", "params": { "merge": "event.output", "builds": { "value": 0 }, "pr": { "value": null }, "verdict": { "value": null } } },
            { "type": "inc", "params": "cursor.slice" }
          ] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "integrating": {
      "meta": { "needs": ["allSlices"] },
      "invoke": {
        "id": "integrate", "src": "build",
        "input": { "brief": { "value": "Open one pull request from your branch into the default branch. Change no file. Title it with the feature's goal and list the slices merged." }, "issue": "context.issue", "lane": { "value": "feature" } },
        "onDone": { "target": "gated", "actions": [{ "type": "set", "params": { "pr": "event.output.attested.prs.0", "verdict": { "value": null }, "decision": { "value": null } } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "gated": {
      "meta": { "needs": ["hasPr", "allSlices"] },
      "initial": "verifying",
      "on": {
        "github.pull_request.synchronize": [
          { "guard": "sameHeadOnPr" },
          { "target": "replanning", "guard": "onPr", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "moved" } }, "failure.head": "event.head_sha" } }] }
        ],
        "github.check_run.completed": { "target": "replanning", "guard": "redOnHead", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "check" } }, "failure.check": "event.check", "failure.conclusion": "event.conclusion", "failure.sha": "event.head_sha", "failure.url": "event.details_url" } }] },
        "github.pull_request.closed": { "target": "replanning", "guard": "mergedOnPr", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "merged-outside" } }, "failure.pr": "event.pr" } }] }
      },
      "states": {
        "verifying": {
          "invoke": {
            "id": "verify", "src": "verify",
            "input": { "expect": "context.issue.expect", "brief": "context.briefs.verifier", "subject": "context.pr.head" },
            "onDone": [
              { "target": "awaitingCiApproval", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
              { "target": "awaitingMerge", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
              { "target": "waitingCi", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
              { "target": "out", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] }
            ],
            "onError": { "target": "out", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
          }
        },
        "waitingCi": {
          "meta": { "needs": ["verifiedHead"] },
          "on": {
            "github.check_suite.completed": [
              { "target": "awaitingCiApproval", "guard": "greenOnHead", "actions": [{ "type": "set", "params": { "ci.head": "event.head_sha", "ci.pr": "event.pr" } }] },
              { "target": "awaitingMerge", "guard": "greenOnHead", "actions": [{ "type": "set", "params": { "ci.head": "event.head_sha", "ci.pr": "event.pr" } }] }
            ]
          },
          "after": { "ciTimeout": { "target": "out", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "ci-timeout" } } } }] } }
        },
        "awaitingMerge": {
          "meta": { "needs": ["verifiedHead", "ciGreen", "ciUntouched"] },
          "invoke": {
            "id": "ask", "src": "ask",
            "input": { "question": { "value": "Merge this feature at the verified commit?" }, "choices": { "value": ["approve", "reject"] }, "pr": "context.pr", "verdict": "context.verdict" },
            "onDone": [
              { "target": "approved", "guard": "choseApprove", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
              { "target": "out", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
            ],
            "onError": { "target": "out", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
          }
        },
        "awaitingCiApproval": {
          "meta": { "needs": ["verifiedHead", "ciGreen", "ciTouched"] },
          "invoke": {
            "id": "ask", "src": "ask",
            "input": { "question": { "value": "This feature changes CI configuration, so its green CI ran on the changed config. Merge it at the verified commit anyway?" }, "choices": { "value": ["approve-ci-change", "reject"] }, "pr": "context.pr", "verdict": "context.verdict" },
            "onDone": [
              { "target": "approved", "guard": "choseApproveCiChange", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
              { "target": "out", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
            ],
            "onError": { "target": "out", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
          }
        },
        "approved": { "type": "final" },
        "out": { "type": "final" }
      },
      "onDone": [
        { "target": "merging", "guard": "approvedPlain" },
        { "target": "merging", "guard": "approvedCiChange" },
        { "target": "replanning" }
      ]
    },
    "merging": {
      "meta": { "needs": ["verifiedHead", "ciGreen", "allSlices"] },
      "invoke": {
        "id": "merge", "src": "merge",
        "input": { "pr": "context.pr", "sha": "context.pr.head" },
        "onDone": { "target": "done", "actions": [{ "type": "set", "params": { "merge": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "replanning": {
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "This feature stalled. Replan it with a written five whys, or drop it? Merged slices stay on the feature branch either way." }, "choices": { "value": ["replan", "drop"] }, "verdict": "context.verdict", "failure": "context.failure", "cursor": "context.cursor" },
        "onDone": [
          { "target": "integrating", "guard": "replan", "description": "every slice is merged: integrate again", "actions": [
            { "type": "set", "params": { "why": "event.output.why", "builds": { "value": 0 }, "pr": { "value": null }, "verdict": { "value": null }, "decision": { "value": null }, "failure": { "value": null } } },
            { "type": "inc", "params": "cursor.attempt" }
          ] },
          { "target": "building", "guard": "replan", "description": "resume at the stalled slice, on a fresh lane; merged slices are kept", "actions": [
            { "type": "set", "params": { "why": "event.output.why", "builds": { "value": 0 }, "pr": { "value": null }, "verdict": { "value": null }, "decision": { "value": null }, "failure": { "value": null } } },
            { "type": "inc", "params": "cursor.attempt" }
          ] },
          { "target": "briefing", "guard": "replan", "description": "no plan yet", "actions": [
            { "type": "set", "params": { "why": "event.output.why", "failure": { "value": null } } },
            { "type": "inc", "params": "cursor.attempt" }
          ] },
          { "target": "dropped", "guard": "drop", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "reenter": true, "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": "dropped"
      }
    },
    "done": { "type": "final", "meta": { "needs": ["isMerged", "allSlices"] } },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "hasIssue": ["context.issue.url", "context.issue.expect"],
      "hasBriefs": ["context.briefs.builder", "context.briefs.verifier", "context.briefs.slices"],
      "buildsLeft": [{ "path": "context.builds", "below": 2 }],
      "allSlices": [{ "path": "context.cursor.slice", "same": "context.briefs.count" }],
      "hasPr": ["context.pr.ref", "context.pr.head"],
      "verifiedHead": [{ "path": "context.verdict.result", "is": "PASS" }, { "path": "context.verdict.attested.subject", "same": "context.pr.head" }],
      "ciGreen": [{ "path": "context.ci.head", "same": "context.pr.head" }, { "path": "context.ci.pr", "same": "context.pr.ref" }],
      "ciUntouched": [{ "path": "context.pr.protected", "is": null }],
      "ciTouched": ["context.pr.protected"],
      "failed": [{ "path": "context.verdict.result", "is": "FAIL" }],
      "choseApprove": [{ "path": "event.output.choice", "is": "approve" }],
      "choseApproveCiChange": [{ "path": "event.output.choice", "is": "approve-ci-change" }],
      "approvedPlain": [{ "path": "context.decision.choice", "is": "approve" }, { "path": "context.pr.protected", "is": null }],
      "approvedCiChange": [{ "path": "context.decision.choice", "is": "approve-ci-change" }],
      "replan": [{ "path": "event.output.choice", "is": "replan" }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "is": "drop" }],
      "isMerged": ["context.merge.sha", { "path": "context.merge.head", "same": "context.verdict.attested.subject" }],
      "onPr": [{ "path": "event.pr", "same": "context.pr.ref" }],
      "sameHeadOnPr": [{ "path": "event.pr", "same": "context.pr.ref" }, { "path": "event.head_sha", "same": "context.pr.head" }],
      "greenOnHead": [{ "path": "event.pr", "same": "context.pr.ref" }, { "path": "event.head_sha", "same": "context.pr.head" }],
      "redOnHead": [{ "path": "event.conclusion", "in": ["failure", "timed_out"] }, { "path": "event.pr", "same": "context.pr.ref" }, { "path": "event.head_sha", "same": "context.pr.head" }],
      "mergedOnPr": [{ "path": "event.outcome", "is": "merged" }, { "path": "event.pr", "same": "context.pr.ref" }]
    },
    "delays": { "buildTimeout": 3600000, "ciTimeout": 3600000 },
    "input": {
      "type": "object", "required": ["issue"],
      "properties": { "issue": { "type": "object", "required": ["url", "expect"], "properties": { "url": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } } }
    },
    "events": {
      "github.check_suite.completed": { "type": "object", "required": ["head_sha", "pr"], "properties": { "head_sha": { "$ref": "#sha" }, "pr": { "type": "string" } } },
      "github.check_run.completed": { "type": "object", "required": ["check", "conclusion", "head_sha", "pr"], "properties": { "check": { "type": "string", "minLength": 1 }, "conclusion": { "type": "string" }, "head_sha": { "$ref": "#sha" }, "pr": { "type": "string" } } },
      "github.pull_request.synchronize": { "type": "object", "required": ["head_sha", "pr"], "properties": { "head_sha": { "$ref": "#sha" }, "pr": { "type": "string" } } },
      "github.pull_request.closed": { "type": "object", "required": ["outcome", "pr"], "properties": { "outcome": { "type": "string" }, "pr": { "type": "string" } } }
    },
    "actors": {
      "brief": { "type": "object", "required": ["builder", "verifier", "slices", "count"], "properties": { "builder": { "type": "string", "minLength": 1 }, "verifier": { "type": "string", "minLength": 1 }, "slices": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } }, "count": { "type": "integer" } } },
      "build": { "type": "object", "required": ["pr", "attested"], "properties": { "pr": { "type": "object", "required": ["url", "headSha"], "properties": { "url": { "type": "string" }, "headSha": { "$ref": "#sha" } } }, "attested": { "$ref": "#attested" } } },
      "verify": { "type": "object", "required": ["result", "report", "attested"], "properties": { "result": { "enum": ["PASS", "FAIL"] }, "report": { "type": "string", "minLength": 1 }, "attested": { "$ref": "#attested" } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "merge": { "type": "object", "required": ["sha", "head"], "properties": { "sha": { "$ref": "#sha" }, "head": { "$ref": "#sha" } } }
    },
    "schemas": {
      "sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
      "attested": { "type": "object", "required": ["run", "digest"], "properties": { "run": { "type": "string" }, "digest": { "type": "string", "pattern": "^[0-9a-f]{64}$" } } }
    }
  }
}
```

### 4.5 research.json

```json
{
  "id": "research",
  "description": "A question to a verified, published report. Three researchers run in parallel; each region ends whether its researcher answers, errors or times out, so the join cannot hang. Sources count only as the host fetched them; the report is verified by digest and published only after a tap.",
  "initial": "framing",
  "context": {
    "question": null, "why": null, "briefs": null, "rounds": 0,
    "answers": { "q1": null, "q2": null, "q3": null }, "errors": { "q1": null, "q2": null, "q3": null },
    "report": null, "verdict": null, "decision": null, "published": null, "failure": null
  },
  "output": { "question": "context.question", "report": "context.report", "verdict": "context.verdict", "published": "context.published" },
  "states": {
    "framing": {
      "meta": { "needs": ["hasQuestion"] },
      "invoke": {
        "id": "brief", "src": "brief",
        "input": { "question": "context.question", "why": "context.why" },
        "onDone": { "target": "researching", "actions": [{ "type": "set", "params": { "briefs": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "researching": {
      "type": "parallel",
      "meta": { "needs": ["hasBriefs"] },
      "states": {
        "r1": { "initial": "running", "states": {
          "running": {
            "invoke": { "id": "r1", "src": "research", "input": { "brief": "context.briefs.q1", "question": "context.question" },
              "onDone": { "target": "ended", "actions": [{ "type": "set", "params": { "answers.q1": "event.output" } }] },
              "onError": { "target": "ended", "actions": [{ "type": "set", "params": { "errors.q1": "event.error" } }] } },
            "after": { "researchTimeout": { "target": "ended", "actions": [{ "type": "set", "params": { "errors.q1": { "value": "timed out" } } }] } }
          },
          "ended": { "type": "final" } } },
        "r2": { "initial": "running", "states": {
          "running": {
            "invoke": { "id": "r2", "src": "research", "input": { "brief": "context.briefs.q2", "question": "context.question" },
              "onDone": { "target": "ended", "actions": [{ "type": "set", "params": { "answers.q2": "event.output" } }] },
              "onError": { "target": "ended", "actions": [{ "type": "set", "params": { "errors.q2": "event.error" } }] } },
            "after": { "researchTimeout": { "target": "ended", "actions": [{ "type": "set", "params": { "errors.q2": { "value": "timed out" } } }] } }
          },
          "ended": { "type": "final" } } },
        "r3": { "initial": "running", "states": {
          "running": {
            "invoke": { "id": "r3", "src": "research", "input": { "brief": "context.briefs.q3", "question": "context.question" },
              "onDone": { "target": "ended", "actions": [{ "type": "set", "params": { "answers.q3": "event.output" } }] },
              "onError": { "target": "ended", "actions": [{ "type": "set", "params": { "errors.q3": "event.error" } }] } },
            "after": { "researchTimeout": { "target": "ended", "actions": [{ "type": "set", "params": { "errors.q3": { "value": "timed out" } } }] } }
          },
          "ended": { "type": "final" } } }
      },
      "onDone": [
        { "target": "synthesizing", "guard": "answered1" },
        { "target": "synthesizing", "guard": "answered2" },
        { "target": "synthesizing", "guard": "answered3" },
        { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": { "value": { "kind": "no-answers" } } } }] }
      ]
    },
    "synthesizing": {
      "meta": { "needs": ["hasBriefs", "roundsLeft"] },
      "invoke": {
        "id": "synthesize", "src": "synthesize",
        "input": { "brief": "context.briefs.synthesizer", "question": "context.question", "answers": "context.answers", "errors": "context.errors", "verdict": "context.verdict" },
        "onDone": { "target": "verifying", "actions": [{ "type": "set", "params": { "report": "event.output", "verdict": { "value": null } } }, { "type": "inc", "params": "rounds" }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "verifying": {
      "meta": { "needs": ["hasReport"] },
      "invoke": {
        "id": "verify", "src": "verify",
        "input": { "expect": "context.question.expect", "brief": "context.briefs.verifier", "subject": "context.report.attested.digest", "sources": "context.report.attested.sources" },
        "onDone": [
          { "target": "awaitingPublish", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "synthesizing", "guard": "failed", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "verdict": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "awaitingPublish": {
      "meta": { "needs": ["reportVerified"] },
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "Publish this verified report?" }, "choices": { "value": ["publish", "reject"] }, "report": "context.report.report", "verdict": "context.verdict" },
        "onDone": [
          { "target": "publishing", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "publishing": {
      "meta": { "needs": ["reportVerified", "publishApproved"] },
      "invoke": {
        "id": "post", "src": "post",
        "input": { "text": "context.report.report" },
        "onDone": { "target": "done", "actions": [{ "type": "set", "params": { "published": "event.output" } }] },
        "onError": { "target": "replanning", "actions": [{ "type": "set", "params": { "failure": "event.error" } }] }
      }
    },
    "replanning": {
      "invoke": {
        "id": "ask", "src": "ask",
        "input": { "question": { "value": "This research stalled. Replan it with a written five whys, or drop it?" }, "choices": { "value": ["replan", "drop"] }, "verdict": "context.verdict", "failure": "context.failure", "errors": "context.errors" },
        "onDone": [
          { "target": "framing", "guard": "replan", "actions": [{ "type": "set", "params": { "why": "event.output.why", "rounds": { "value": 0 }, "answers": { "value": { "q1": null, "q2": null, "q3": null } }, "errors": { "value": { "q1": null, "q2": null, "q3": null } }, "report": { "value": null }, "verdict": { "value": null }, "decision": { "value": null }, "failure": { "value": null } } }] },
          { "target": "dropped", "guard": "drop", "actions": [{ "type": "set", "params": { "decision": "event.output" } }] },
          { "target": "replanning", "reenter": true, "actions": [{ "type": "set", "params": { "decision": "event.output" } }] }
        ],
        "onError": "dropped"
      }
    },
    "done": { "type": "final", "meta": { "needs": ["reportVerified", "publishApproved", "isPublished"] } },
    "dropped": { "type": "final" }
  },
  "meta": {
    "guards": {
      "hasQuestion": ["context.question.text", "context.question.expect"],
      "hasBriefs": ["context.briefs.q1", "context.briefs.q2", "context.briefs.q3", "context.briefs.synthesizer", "context.briefs.verifier"],
      "answered1": ["context.answers.q1.attested.sources"],
      "answered2": ["context.answers.q2.attested.sources"],
      "answered3": ["context.answers.q3.attested.sources"],
      "roundsLeft": [{ "path": "context.rounds", "below": 2 }],
      "hasReport": ["context.report.attested.digest", "context.report.attested.sources"],
      "failed": [{ "path": "context.verdict.result", "is": "FAIL" }],
      "reportVerified": [{ "path": "context.verdict.result", "is": "PASS" }, { "path": "context.verdict.attested.subject", "same": "context.report.attested.digest" }],
      "publishApproved": [{ "path": "context.decision.choice", "is": "publish" }],
      "isPublished": ["context.published.ref"],
      "replan": [{ "path": "event.output.choice", "is": "replan" }, "event.output.why"],
      "drop": [{ "path": "event.output.choice", "is": "drop" }]
    },
    "delays": { "researchTimeout": 3600000 },
    "input": {
      "type": "object", "required": ["question"],
      "properties": { "question": { "type": "object", "required": ["text", "expect"], "properties": { "text": { "type": "string", "minLength": 1 }, "expect": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } } } }
    },
    "events": {},
    "actors": {
      "brief": { "type": "object", "required": ["q1", "q2", "q3", "synthesizer", "verifier"], "properties": { "q1": { "type": "string", "minLength": 1 }, "q2": { "type": "string", "minLength": 1 }, "q3": { "type": "string", "minLength": 1 }, "synthesizer": { "type": "string", "minLength": 1 }, "verifier": { "type": "string", "minLength": 1 } } },
      "research": { "type": "object", "required": ["answer", "sources", "attested"], "properties": { "answer": { "type": "string", "minLength": 1 }, "sources": { "$ref": "#sources" }, "attested": { "$ref": "#attested" } } },
      "synthesize": { "type": "object", "required": ["report", "sources", "attested"], "properties": { "report": { "type": "string", "minLength": 1 }, "sources": { "$ref": "#sources" }, "attested": { "$ref": "#attested" } } },
      "verify": { "type": "object", "required": ["result", "report", "attested"], "properties": { "result": { "enum": ["PASS", "FAIL"] }, "report": { "type": "string", "minLength": 1 }, "attested": { "$ref": "#attested" } } },
      "ask": { "type": "object", "required": ["choice", "by"], "properties": { "choice": { "type": "string" }, "by": { "type": "string", "minLength": 1 }, "why": { "type": "string" } } },
      "post": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string", "minLength": 1 } } }
    },
    "schemas": {
      "sources": { "type": "array", "minItems": 1, "items": { "type": "object", "required": ["url", "quote"], "properties": { "url": { "type": "string", "pattern": "^https://" }, "quote": { "type": "string", "minLength": 1 } } } },
      "attested": { "type": "object", "required": ["run", "digest"], "properties": { "run": { "type": "string" }, "digest": { "type": "string", "pattern": "^[0-9a-f]{64}$" } } }
    }
  }
}
```

Spec size (pretty-printed, `JSON.stringify(x, null, 2)`): quick-fix 1050, feature 1275, research 856 lines, 3181 in
total (baseline quick-fix: 799). The growth is mostly ordered candidate lists and repeated action objects. There are
no new mechanisms behind it.

---

## 5. Scenarios: mechanism and test

**Test harness (shared, extends `packages/engine/test/parity/world.js`):**
- `fakeGitHub`: each PR also has `base` (default `"main"`), `branch` and `files` (default `["src/x.js"]`). Add
  `GET …/pulls/n/files`. Merge checks a sent `sha` as today. Add `mergeOutside(n)` and `pushTo(n, sha)`.
- `pages(map)`: a local HTTP server for source URLs (R1). `observe.fetch` points at it.
- `attestedAgents(outputs, { gh, heads, root, item })`: like `agents()`, but each stub output goes through the real
  `attest()`. The run is `{ run: effect.id, input: effect.input, branch: laneBranch(item, input.lane) or the run
  branch, into: intoBranch(item, input.into) }`. `observe.head` is `heads[effect.id] ?? effect.input.subject`, so a
  test can put a verifier's worktree somewhere else. It also offers `find(effect)`, which returns `{ ref }` for an
  effect id it already started (this stands for the run folder).
- Events, in the real wake shapes (`fixtures/wakes/`): `checkSuite(head, pr)`, `checkRun(head, pr, conclusion)`,
  `synchronize(head, pr)`, `closed(pr)`. Taps use `tapWake(card, index)`.
- Each test file `node --test`s on its own, under `packages/engine/test/scenarios/`.

`Q1`–`Q9` drive quick-fix, `F1`–`F2` drive feature, and `R1` drives research. A, B and C are distinct shas, and
`o/r#1` is PR 1.

| Id | Mechanism | Events the test drives → assertions |
|---|---|---|
| **Q1** | Attestation chain: `pr` from attest, a verdict with `subject == pr.head`, `ci` recorded at the root, one ask, and merge at `pr.head` (`expectedHeadSha`). `done` needs `merge.head same verdict.attested.subject` | init → brief out → build claims `#1@A` (GH: head A, branch `ccp/it-1/1`, base main) → verify PASS (observed head A) → `checkSuite(A, o/r#1)` → tap 0 → **state `done`; `gh.merges == [{1, A}]`; `plat.cards.length == 1` (one tap)**. Variant: the CI event comes before the verdict, and the item still goes straight to awaitingMerge |
| **Q2** | `github.pull_request.synchronize` on the item's PR at a head other than `pr.head` takes `gated` back to `building` (an unattested head must be re-attested by the current attempt's builder). A synchronize at the attested head is consumed (targetless first candidate). The merge effect's `expectedHeadSha` is the backstop | Q1 up to awaitingMerge at A → `synchronize(A)` (stays) → `gh.pushTo(1,B)`, `synchronize(B)` → **state `building`, the ask run stopped, no merge**; a tap on the old card offers nothing → build re-claims `#1@B` → verify PASS at B → `checkSuite(B)` → tap → **`gh.merges == [{1, B}]`** |
| **Q3** | `check_run.completed` red, `same` head and pr, handled at `gated`. Ordered candidates: building (needs `buildsLeft`), else replanning. `failure` is typed `{kind:"check", check, conclusion, sha, url}` | to `gated.verifying` at A → `checkRun(A,'failure')` → **state `building`; the new build run's `input.failure` deep-equals `{kind:'check',check:'test',conclusion:'failure',sha:A,url}`** → build `#1@B` → `checkRun(B,'failure')` → **state `replanning`, `builds == 2`, no third build started** |
| **Q4** | attest stamps `pr.protected` from GitHub's file list. `awaitingMerge` needs `protected is null`, and `awaitingCiApproval` needs it present, with its own question and choices. `approvedPlain` also needs `protected is null`, so only `approve-ci-change` reaches merging | GH files of #1 = `[".github/workflows/ci.yml"]` → build → verify PASS A → `checkSuite(A)` → **state `{gated:"awaitingCiApproval"}`; the card's choices are `["approve-ci-change","reject"]`; no merge**. Tap reject → **`replanning`, `gh.merges == []`**. Second test: tap `approve-ci-change` → **`done`**. Third (pure): a decision of `approve` with protected paths set does not reach `merging` |
| **Q5** | The verify run's subject is `pr.head`, and the verdict counts by `attested.subject`, the HEAD the host read from the worktree. A `sha` in the result is ignored | build `#1@A` → `checkSuite(A)` → verify returns `{result:'PASS', sha:A, report}` with `heads[verifyRun]=C` → **`verdict.attested.subject == C`; state `replanning`; no `ask` card for merge; `gh.merges == []`** |
| **Q6** | Lanes: attempt 1 is on `ccp/it-1/1` (#1) and attempt 2 on `ccp/it-1/2` (#2). Every PR event is guarded by `event.pr same pr.ref`, so #1's events are refused. A late `return` from attempt 1's run is stale (the run is not in flight), and a build claiming #1 in attempt 2 is refused by attest (rule `lane`) | build #1@A, FAIL, build #1@B, FAIL → replanning → done(ask, `{choice:'replan', why}`) → brief → build #2@C (branch `ccp/it-1/2`) → `synchronize(X, o/r#1)` and `checkRun(B, o/r#1)` → **both outcomes are `refused`, state `{gated:"verifying"}`, `pr.ref == 'o/r#2'`** → verify PASS C → `checkSuite(C, o/r#2)` → tap → **`gh.merges == [{2, C}]`**. Plus: `attest` on an attempt-2 result claiming #1 → `{refused:{rule:'lane'}}` |
| **Q7** | `pull_request.closed` with `outcome: merged` on the item's PR, handled at `gated` → replanning with `failure.kind = merged-outside`. `done` needs `merge.head same verdict.attested.subject`, which only the merge effect's output gives. In `merging`, the event isn't taken, and the merge effect's own 405 sends onError | awaitingMerge at A → `gh.mergeOutside(1)`, `closed(o/r#1)` → **state `replanning`, `failure.kind == 'merged-outside'`** → tap drop → **`snapshot.value == 'dropped'`, `context.merge == null`, never `done`**. The existing journal check still lists #1 as merged outside the host |
| **Q8** | Load-time pin: the item's first row names `quick-fix@<d1>`, and restore loads `blobs/<d1>` | `openItem` with v1 → Q1 up to awaitingMerge → write v2 to the workflows dir (choices `["ship","reject"]`, and merging also needs a guard that fails) → `openItem` again (new host) → **`host.spec.id` ends with `@d1`**; tap 0 → **`done`**; `replay(pinnedWorkflow(root,item), entries)` returns the same hash. Also, `restore` given v2 directly throws "the workflow changed", which shows why the pin is needed |
| **Q9** | `issue.expect` is fixed in context at init, and the verify input is `expect: context.issue.expect`. No event writes `issue` (`github.issues.edited` isn't in meta.events). The verifier's prompt line 5 forbids reading the issue | to `building` → offer `{type:'github.issues.edited', issue:7, body:'- [ ] something else'}` → **outcome `refused` ("not an event quick-fix takes")** → build → **the verify run's `input.expect` deep-equals the filed expect**; its `context.md` contains the expect line; the brief hashes are unchanged |
| **F1** | Flat slices in one item: a `cursor {slice, attempt}` lane per slice, host merge into `ccp/<item>/feature` (no tap), and `builds below 2` per slice → replanning. Replan resumes at `cursor.slice` on a new lane (attempt+1), building on the feature lane's tip, where slice 0's merge stays. `integrating` opens feature → main, and `gated` verifies **issue.expect** at the integration head with one tap | brief `{slices:[s0,s1,s2],count:3}` → slice 0: build #1 (base `ccp/it/feature`) → PASS → merge into feature (**base checked**) → slice 1: build #2 FAIL, build #2 FAIL → **`replanning`, `builds==2`, `cursor.slice==1`, `merge.head==head#1`, GH #1 still merged** → replan (escalation tap) → slice 1 attempt 2: build #3 on `ccp/it/slice-1-attempt-2` → PASS → merge → slice 2 → merge → `integrating` → build claims #5 (head `ccp/it/feature`, base main) → verify PASS (input.expect == issue.expect) → `checkSuite` → **one merge card** → tap → **`done`; only #5 merged into main; merge taps == 1** |
| **F2** | Effect ids are deterministic (`<item>:<seq>.<invoke>`). The restored owner host replays to the same ids, and a run effect with a `start` row and no end goes through `find()` (the run folder) and doesn't start again. A host with another session is not the owner and starts nothing | host A: to slice 1 `building`, with the build handler's `start` returning a promise that never resolves (A dies after the `start` row is persisted) → host B = `restore` (same root, owner session) → `offer(B, [])` with `find` → **started count for that effect id == 1; B's effect row phase is `done` with `found:true`** → result returned on B → `verifying`. Host C (other session) → `offer` → **nothing started; outcome `not-owner`** |
| **R1** | `researching` is parallel with three regions. Each region ends on onDone, onError or `after researchTimeout`, so the state-level onDone join always fires. Ordered candidates go on to synthesizing if any answer exists. attest fetches every source itself and stores the body by digest. The verifier gets `subject: report.attested.digest` and `sources` (host digests, materialized). `awaitingPublish` needs `verdict.attested.subject same report.attested.digest`. `publishing` needs a `publish` decision | init → brief → **three run effects in one transition (r1, r2, r3)** → r1 returns (sources served by `pages`) → task notification `failed` for r2 (→ `xstate.error.actor.r2`) → r3 returns → **state `synthesizing`; `errors.q2` set** → synthesizer returns a quote not on its page → **`attest` refuses (rule `source`)**; it returns again with true quotes → **`report.attested.sources[i].digest == sha256(served body)`**; the verify run's input.sources has those digests and its worktree has `.ccp/blobs/<d>` → verify PASS (`.ccp/subject` unchanged) → **`awaitingPublish`, `plat.posts.length == 0`** → tap publish → **`done`; one post whose text is `report.report`; one tap** |

**Person taps:** Q1 happy path takes **1**. F1 takes **1** for the feature's merge, plus the one escalation tap that
the scenario's failing slice forces (a feature whose slices pass takes 1 in total). R1 takes **1**.

---

## 6. What I leave out, and why

- **Child items and cross-item relations.** Slices are lanes inside one item. F2 is met by effect-id idempotency,
  which already exists. Parent/child items would add a relation primitive, spawn effects and a second journal to
  replay.
- **Signatures on attestations.** The trust boundary is the host and its hooks: only `accept()` writes
  `result.json`, and agents' file tools are confined to their worktrees (`confine`). Signing adds key handling and
  proves nothing more inside one host.
- **A CI polling effect.** CI facts come from platform wakes. They are recorded at the root in any state, so a green
  CI that arrives early isn't lost. A suite that never reports ends in `ciTimeout` → replanning, never a silent hang.
- **Changing `expect` mid-flight, even with the person.** The person replans (or files a new item). A "adopt the
  edited acceptance?" card would cost a state and a tap for a rare case.
- **Showing the protected file list on the card.** The CI card's own question and choice (`approve-ci-change`) make
  the approval explicit. Rendering `pr.protected` would mean changing card.js.
- **`always`, `#id` targets, `not`/`or` guard forms.** Ordered candidates already give else, or, and "is absent"
  (`is: null`).
- **CI gating on slice PRs.** CI often doesn't run on PRs into non-default branches. The feature gate verifies and
  CI-checks the integrated head before main.
- **Re-verifying instead of rebuilding after an unattested push.** Q2 deliberately sends a moved head back to the
  builder, so every subject the verifier sees was attested by a live build run. It costs a build round, and it
  closes Q6-style injection on a reused PR.
- **Defence against a verifier that checks out another commit and back.** Measuring at return catches the reported
  case (Q5). Reflog auditing is out of scope.
- **Closing a dead attempt's PR.** It is no longer the item's subject, and it has no effect on gates or merge.

---

## 7. Checked so far (not a substitute for the tests above)

In a scratch copy of `packages/engine/src` with only the one-line `onDone` binding added (the checkout is
unmodified), these all ran:
- `checks/t-qf.mjs`: pure transitions of quick-fix for Q1 (and the variant with CI first), Q2, Q3, Q4 (reject and
  approve-ci-change), Q5, Q6 and Q7. Each ends in the stated state. The same script passes with the pinned id
  `quick-fix@<sha256>`.
- `checks/t-f.mjs`: F1's full path. Slice 1 fails twice → replanning with slice 0's merge kept → replan →
  slices 1–2 → integrating → one tap → `done`.
- `checks/t-r.mjs` and `checks/t-host.mjs`: R1 through pure transitions, and through the **real host.js** (copied)
  with stub handlers. Three parallel run effects, r2 throws, the join fires, a tap, a post, and `restore()` replays to
  `done`. This confirms host.js needs no change for parallel invokes.

None of these is one of the scenario tests in section 5. Those need attest.js, the lane and subject work in
`prepare()`, and the world.js extensions listed there.
