# PR gates

Two workflows run on every PR into `main`. Merge only when both are green at the PR's head sha. They hold the
rules in `plan/README.md`, "How slop is kept out", so the builder isn't the one enforcing them.

| Workflow | Step | Fails when |
|---|---|---|
| `ci` | `npm test` | any test under `test/`, `scripts/`, `packages/`, `plugins/` or `verify/` fails |
| `ci` | plan check | `node plan/check.mjs` refuses the plan |
| `verdict` | no stubs | a file under `packages/` or `plugins/` has TODO, FIXME, "not implemented" or a skipped test |
| `verdict` | contract freeze | the PR changes a frozen item's head or Verifier brief and isn't a plan-only replan |
| `verdict` | verdict | the named item has no complete verdict at the head sha, or it came from a builder's session |

The logic is in `scripts/gates/lib.mjs` (pure checks) and `scripts/gates/pr-gate.mjs` (reads git and the PR).
Run a gate locally with `BASE_SHA=origin/main node scripts/gates/pr-gate.mjs verdict`, adding `PR_BRANCH`,
`PR_BODY` and `PR_LABELS` as the PR would have them.

## Naming the item

A PR names its item with a line `Item: <item-id>` in its body, or with a branch named `<kind>/<item-id>`. If
both name one, they must agree. A PR that names no item passes the verdict gate only if it changes nothing
outside `plan/` (decisions, research, replans).

## The verdict

The verifier, a session other than the builder's, commits `verify/<item>/verdict.json`:

```json
{
  "item": "repo-skeleton",
  "verified_sha": "<the commit the verifier checked out>",
  "verifier": { "session": "<its Claude-Session value>", "model": "<model id>" },
  "results": [
    { "id": "ci-runs", "status": "MET", "command": "what it ran", "excerpt": "what it saw" },
    { "id": "some-builder-line", "status": "MET", "command": "npm test", "excerpt": "...",
      "mutation": "the code it broke", "red_test": "the test that went red" }
  ]
}
```

The gate checks, against the item head at the PR head sha:

- every Expect id has a result marked `MET`, with a non-empty `command` and `excerpt`, and no result names an
  id the head doesn't have;
- every Expect line with proof `builder` has a `mutation` and a `red_test`;
- `verified_sha` is in the PR's history, and no later commit changes anything outside `verify/` (a builder
  change after verification needs a new verdict);
- the last commit that wrote `verdict.json` has a `Claude-Session:` trailer, and no commit that changes
  anything outside `verify/` carries the same one.

## Sessions

Every commit ends with `Claude-Session: <id>`. A thread uses its session URL. A subagent working inside a
thread names itself as `<thread session URL>#agent=<name>`, so a verifier subagent's verdict commit is told
apart from the thread that built the item. This is identity by convention, not proof: every agent acts as the
same GitHub account, and a builder could forge the trailer (ledger L-same-account-everywhere). The journal
records which session wrote what, and the stage gates put real results in front of the person.

## The contract freeze

An item is frozen when the PR names it, or when its status at the base is `doing` or `done`. A frozen item's
head (every field but `status`) and its `## Verifier brief` section must not change. The only exception is a
PR labelled `replan` that changes nothing outside `plan/`. Changing `status` is always allowed, so a build PR
can mark its item `done`.

## After the merge: the release

A merge that changes `plugins/harness/` or `packages/journal/` (tests aside) is released by the thread that merged
it: `git fetch origin main && node scripts/release/release.mjs branch --push`. That pushes `release/harness-v<x.y.z>`
at the merge, and prints a `ci.result` row for the thread's journal. It makes nothing when the merge changed no
released file or is already released, so running it after every merge is safe. `.github/workflows/release.yml`
makes the same release as a tag when Actions runs. See `plugins/harness/README.md`, "Releases".
