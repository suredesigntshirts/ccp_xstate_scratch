```json
{
  "id": "wf-quick-fix",
  "title": "Port PR #110's machine as the quick-fix workflow, with v1's hardest cases as tests",
  "stage": "s2-workflow-model",
  "kind": "build",
  "status": "ready",
  "outcome": "workflows/quick-fix.json holds #110's item machine (briefing, building, verifying, awaitingMerge, merging, replanning, done, dropped) on xstate 5.33.3, with tests on pure transitions for the cases that cost v1 most.",
  "why": "PR #110 already ran this machine end to end with real actors, replay and stale-run refusal, in about 650 lines and with 9 precondition guards. Port it, don't redesign it. The schema for many workflows waits until a second workflow needs it.",
  "serves": [
    "L-merge-at-verified-head",
    "L-replan-after-second-fail",
    "L-walking-skeleton-control-first",
    "L-build-for-next-real-item",
    "L-rules-in-spec-not-host",
    "L-xstate-version",
    "L-missing-input-passes",
    "L-expect-checkable-before-accept"
  ],
  "depends_on": [
    "repo-skeleton"
  ],
  "inputs": [
    {
      "ref": "ccp_machine origin/claude/project-thread-3kdqwr: packages/orchestrator/spec/item.machine.json, src/spec.js, src/step.js, test/",
      "what": "The machine, its guards and tests"
    }
  ],
  "outputs": [
    {
      "ref": "workflows/quick-fix.json",
      "what": "The machine as data"
    },
    {
      "ref": "packages/engine/src/spec.js (ported)",
      "what": "Loads a workflow file into XState"
    },
    {
      "ref": "packages/engine/test/cases/",
      "what": "Tests named by case id"
    }
  ],
  "expect": [
    {
      "id": "cases",
      "check": "Tests for C-verdict-on-old-head, C-push-after-pass, C-second-fail-replans and C-missing-expect-fails-closed pass",
      "how": "npm test; test names carry the case ids",
      "proof": "verifier"
    },
    {
      "id": "fail-closed",
      "check": "Every guard fails when its context field is absent",
      "how": "One absent-input test per guard",
      "proof": "verifier"
    },
    {
      "id": "pinned",
      "check": "xstate is pinned to 5.33.3",
      "how": "package.json",
      "proof": "verifier"
    },
    {
      "id": "replays-110",
      "check": "A journal recorded by PR #110's real headless run replays through the ported machine to the same final state",
      "how": "The verifier takes the journal from ccp_machine branch claude/project-thread-3kdqwr and replays it",
      "proof": "world"
    }
  ],
  "cases": [
    "C-verdict-on-old-head",
    "C-push-after-pass",
    "C-second-fail-replans",
    "C-missing-expect-fails-closed"
  ],
  "concepts": {
    "adds": [
      "workflow file"
    ],
    "budget": 1
  },
  "non_goals": [
    "No workflow schema or catalogue (wf-schema, wf-catalogue in s4b-widen)",
    "None of #110's inspector, page or lens-agent work"
  ],
  "records": [
    "None at build time; the host journals the workflow id and hash per item"
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

Read plan/cases/work-item.md first, not the code. For each case named, write your own test from the case text
against the ported workflow and run it. Then run the builder's tests and confirm xstate's pinned version. Verdict per
Expect id.
