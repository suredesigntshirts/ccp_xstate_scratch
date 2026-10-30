```json
{
  "id": "repo-skeleton",
  "title": "Set up the repo so every later item has one way to test, check and find things",
  "stage": "s0-environment",
  "kind": "build",
  "status": "done",
  "outcome": "ccp_xstate main has workspaces, node:test, CI running the tests and the plan check, a short CLAUDE.md that maps into docs/, and branch rules.",
  "why": "Every item needs the same test and CI path. A short CLAUDE.md that points into docs keeps standing knowledge checkable instead of one drifting file. Until v2 runs its own items, the plan items are built by hand, so CI is the only thing holding the verify-before-merge rule (plan-review finding 11).",
  "serves": [
    "L-count-concepts",
    "L-expect-format-one-owner",
    "L-merge-at-verified-head",
    "L-no-checks-the-builder-writes",
    "L-no-trust-boundary",
    "L-proof-source",
    "L-review-footer",
    "L-same-account-everywhere",
    "L-theory-written",
    "L-verifier-independent"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "ccp_machine CLAUDE.md",
      "what": "Branch naming and principles to carry over"
    },
    {
      "ref": "plan/research/workflows.md",
      "what": "OpenAI's AGENTS.md-as-map pattern"
    }
  ],
  "outputs": [
    {
      "ref": "package.json, packages/, plugins/",
      "what": "npm workspaces; Node 22+, zero runtime dependencies except xstate"
    },
    {
      "ref": ".github/workflows/ci.yml",
      "what": "npm test and node plan/check.mjs on every PR"
    },
    {
      "ref": "CLAUDE.md",
      "what": "Under 100 lines: principles, branch rules, a map to docs/ and plan/"
    },
    {
      "ref": ".github/workflows/verdict.yml",
      "what": "Checks verify/<item>/verdict.json against the item head at the PR head sha, the separate verifier session, the contract freeze and the stub ban"
    }
  ],
  "expect": [
    {
      "id": "ci-runs",
      "check": "CI runs npm test, the verify/ tests and the plan check on a PR, and fails when any fails",
      "how": "A PR with a deliberately broken plan item shows a red check; reverting it shows green",
      "proof": "world"
    },
    {
      "id": "branch-rule",
      "check": "CLAUDE.md states the branch convention without a claude/ prefix",
      "how": "Read it",
      "proof": "verifier"
    },
    {
      "id": "short-map",
      "check": "CLAUDE.md is under 100 lines and every path it names exists",
      "how": "The verifier lists the paths with a script and runs wc -l",
      "proof": "verifier"
    },
    {
      "id": "verdict-gate",
      "check": "CI fails a PR into main unless verify/<item>/verdict.json at the head sha marks every Expect id in the item head MET, each with the command run and an output excerpt, and names a mutation and the test it turned red for every builder-proof line",
      "how": "Three test PRs: no verdict (red), a verdict missing one Expect id (red), a complete verdict (green)",
      "proof": "world"
    },
    {
      "id": "separate-session",
      "check": "CI fails when the commit adding verdict.json carries the same Claude-Session trailer as any builder commit in the PR",
      "how": "A test PR whose verdict commit reuses the builder session shows red",
      "proof": "world"
    },
    {
      "id": "contract-frozen",
      "check": "CI fails a PR that names an item (branch or body) and changes that item's head or its Verifier brief, unless the PR is labelled replan and touches only plan/",
      "how": "A test PR that softens one Expect line of the item it builds shows red",
      "proof": "world"
    },
    {
      "id": "no-stubs",
      "check": "CI fails on TODO, FIXME, \"not implemented\" or a skipped test under packages/ and plugins/",
      "how": "A test PR adding one TODO shows red",
      "proof": "world"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [
      "workspace layout",
      "verdict gate",
      "contract freeze"
    ],
    "budget": 3
  },
  "non_goals": [
    "No harness code",
    "No plugin yet"
  ],
  "records": [
    "None; the journal does not exist yet"
  ],
  "person_prereqs": [
    "Allow pushing to main for this first commit, or create main with an empty commit, since the repo has no commits"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": []
}
```

## Verifier brief

Check out the PR head. Run `npm test` and `node plan/check.mjs`. Open the test PRs named in the Expect lines
yourself (no verdict, a verdict missing one id, a verdict from the builder's session, a softened Expect line, a TODO)
and confirm each is red for the stated reason, then confirm the PR's own run is green. Check every path named in
CLAUDE.md exists. Write verify/repo-skeleton/verdict.json in your own commit.
