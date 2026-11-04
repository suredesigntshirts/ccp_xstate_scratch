```json
{
  "id": "engine-effects",
  "title": "Do every outside action as a host effect: merge, post, card, timer",
  "stage": "s3-engine-skeleton",
  "kind": "build",
  "status": "done",
  "outcome": "Merging, posting, cards and timers happen only as host effects keyed by effect id. Merge uses the GitHub merge tool at verdict.sha exactly, and any merge done another way is caught by the journal check.",
  "why": "In v1, agents called gh directly and gates parsed Bash to guess intent: 73 denials for about 4 catches. GitHub's agentic workflows make agents read-only and route writes through declared outputs. v2 does the same with host effects.",
  "serves": [
    "L-text-is-not-intent",
    "L-authenticate-facts-ok",
    "L-merge-at-verified-head",
    "L-merge-authority",
    "L-merge-without-review-flag",
    "L-effects-acked-once",
    "L-graphql-blocked"
  ],
  "depends_on": [
    "engine-host"
  ],
  "inputs": [
    {
      "ref": "PR #110 host effects",
      "what": "Prior art"
    }
  ],
  "outputs": [
    {
      "ref": "packages/engine/src/effects/{merge,post,card,timer}.js",
      "what": "Each takes an effect row and returns an outcome row"
    }
  ],
  "expect": [
    {
      "id": "merge-at-sha",
      "check": "Merge passes expectedHeadSha equal to verdict.sha; when a commit lands after the verdict, the merge fails and the PR stays open",
      "how": "A scratch PR in a scratch repo, pushed to between verdict and merge",
      "proof": "world"
    },
    {
      "id": "outside-merge",
      "check": "A PR merged outside the host is listed by the journal check",
      "how": "The verifier writes its own test from case C-merge-outside-host-detected",
      "proof": "verifier"
    },
    {
      "id": "no-bash",
      "check": "No effect runs a shell command: with child_process and $.process wrapped during the effects suite, they record zero calls",
      "how": "Test wraps both at runtime, so code outside effects/ or a dynamic import is still caught",
      "proof": "builder"
    },
    {
      "id": "red-ci",
      "check": "A red CI result on the item's PR sends the item back to building, with the failing check's name in context",
      "how": "A scratch PR with a deliberately failing check, case C-red-ci-back-to-building",
      "proof": "world"
    }
  ],
  "cases": [
    "C-merge-outside-host-detected",
    "C-red-ci-back-to-building"
  ],
  "concepts": {
    "adds": [
      "effect kinds"
    ],
    "budget": 1
  },
  "non_goals": [
    "No GitHub rulesets yet (parked until a separate verdict identity is needed)"
  ],
  "records": [
    "engine.effect with outcome"
  ],
  "person_prereqs": [
    "Allow rule: the host merges a PR at the verified head after an independent PASS and green CI"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": []
}
```

## Verifier brief

Read cases C-merge-outside-host-detected and C-red-ci-back-to-building first and write your own test for the
first. On a scratch repo: push to a PR between its verdict and the merge effect and confirm no merge happens; make a
check fail and confirm the item returns to building with that check named. Write verify/engine-effects/verdict.json
in your own commit, with a mutation for the builder line.
