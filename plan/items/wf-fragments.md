```json
{
  "id": "wf-fragments",
  "title": "Build the reusable pieces every code workflow needs, with v1's hard cases as tests",
  "stage": "s4b-widen",
  "kind": "build",
  "status": "parked",
  "outcome": "Four fragments exist as data with tests on pure transitions: verify at a head, merge at the verified head, replan after the second FAIL, and wait on a card.",
  "why": "Parked by retro-first-item (finding 6): the first real item ran on quick-fix unchanged, and nothing in it needed a schema, fragment or new workflow. It comes back when a real item needs a workflow quick-fix can't run. The cases v1 learned the hardest (merge after a FAIL, push after a PASS, five rounds without stepping back, cards stalling) belong in shared pieces tested once, not rewritten in every workflow.",
  "serves": [
    "L-merge-at-verified-head",
    "L-replan-after-second-fail",
    "L-verifier-independent",
    "L-stand-in-decides",
    "L-missing-input-passes",
    "L-walking-skeleton-control-first",
    "L-expect-checkable-before-accept"
  ],
  "depends_on": [
    "wf-schema",
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "plan/cases/work-item.md",
      "what": "The cases the fragments must pass"
    }
  ],
  "outputs": [
    {
      "ref": "packages/workflow/fragments/{verify-at-head,merge-at-verified-head,replan-after-second-fail,card-wait}.json",
      "what": "Fragments"
    },
    {
      "ref": "packages/workflow/test/cases/",
      "what": "One test per case, named by case id"
    }
  ],
  "expect": [
    {
      "id": "cases-pass",
      "check": "Tests for C-verdict-on-old-head, C-push-after-pass, C-pass-carries-to-merge-of-main, C-second-fail-replans, C-stand-in-picks-legal-event pass",
      "how": "npm test; test names carry the case ids",
      "proof": "verifier"
    },
    {
      "id": "fail-closed",
      "check": "Each fragment's guards fail when their context field is absent",
      "how": "One absent-input test per guard",
      "proof": "verifier"
    }
  ],
  "cases": [
    "C-verdict-on-old-head",
    "C-push-after-pass",
    "C-pass-carries-to-merge-of-main",
    "C-second-fail-replans",
    "C-stand-in-picks-legal-event"
  ],
  "concepts": {
    "adds": [],
    "merges": [
      "v1's landing gate, replan rule and decision machine into fragments"
    ],
    "budget": 0
  },
  "non_goals": [
    "No host; tests drive pure transitions"
  ],
  "records": [
    "None at build time"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": []
}
```

## Verifier brief

Read plan/cases/work-item.md first, not the code. For each case the item names, write your own test from the case
text against the fragment and run it. Then run the builder's tests. Verdict per Expect id.
