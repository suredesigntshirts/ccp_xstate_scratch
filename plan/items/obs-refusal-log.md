```json
{
  "id": "obs-refusal-log",
  "title": "Record every refusal with its rule, its retry and how it ended",
  "stage": "s1-observability",
  "kind": "build",
  "status": "done",
  "outcome": "Each auto mode or hook refusal becomes a refusal row naming its source, rule, a hash of the refused action, whether it was retried and the outcome.",
  "why": "Refusals cost v1 the most time and were never counted. Without the action hash, v1 couldn't even tell true catches from false ones.",
  "serves": [
    "L-refusals-unmeasured",
    "L-retries-look-like-bypass",
    "L-cost-asymmetry",
    "L-classifier-judges-the-request"
  ],
  "depends_on": [
    "obs-live-capture"
  ],
  "inputs": [
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "How a classifier refusal shows up to hooks and mods"
    }
  ],
  "outputs": [
    {
      "ref": "plugins/harness/hooks/capture (refusal handling)",
      "what": "refusal {source: classifier|hook|permission, rule, actionHash, tool, retryOf, outcome}"
    }
  ],
  "expect": [
    {
      "id": "captured",
      "check": "A refusal fixture recorded during the probe becomes one refusal row with the classifier's rule text",
      "how": "Unit test on the fixture",
      "proof": "builder"
    },
    {
      "id": "hook-denials",
      "check": "A denial by one of our own hooks produces a refusal row with source hook and the rule name",
      "how": "The verifier triggers a denial by one of our own hooks in its own session",
      "proof": "verifier"
    },
    {
      "id": "retry-linked",
      "check": "Given a refusal fixture recorded during the probe and a later identical action, the second row links to the first by retryOf",
      "how": "Unit test on recorded fixtures; nothing is refused or retried live",
      "proof": "builder"
    },
    {
      "id": "live",
      "check": "A harmless refusal triggered in a real v2 session becomes one refusal row carrying the classifier's rule text",
      "how": "The probe's recipe, run by the verifier",
      "proof": "world"
    }
  ],
  "cases": [
    "C-refused-action-not-retried"
  ],
  "concepts": {
    "adds": [
      "refusal row"
    ],
    "budget": 1
  },
  "non_goals": [
    "Doesn't prevent or work around refusals"
  ],
  "records": [
    "refusal"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "If refusals aren't visible to hooks or mods at all, this item becomes a periodic read of the session event log (permission_denied) and says so"
  ]
}
```

## Verifier brief

Trigger one harmless refusal using the probe's recipe and confirm one row with the rule text. Retry once and confirm
the link. Run the hook tests. Verdict per Expect id.
