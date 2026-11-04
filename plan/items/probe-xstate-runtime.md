```json
{
  "id": "probe-xstate-runtime",
  "title": "Pick XState 5 or 6 by testing persistence, restore and stale completions",
  "stage": "s3-engine-skeleton",
  "kind": "probe",
  "status": "parked",
  "outcome": "A short report says which XState version the engine uses, from tests of snapshot persistence, restore across a process restart, and dropping a completion from a replaced actor run.",
  "why": "Parked: pin xstate 5.33.3, which PR #110 already ran end to end with restore and stale-run refusal. Revisit as a spike if v6 durable execution is needed (plan-review finding 3).",
  "serves": [
    "L-xstate-version",
    "L-replay-facts-not-rules"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "packages/workflow (compiled quick-fix)",
      "what": "A real compiled workflow"
    }
  ],
  "outputs": [
    {
      "ref": "plan/research/xstate-runtime.md",
      "what": "Results per version, and the choice with its reason"
    }
  ],
  "expect": [
    {
      "id": "restore",
      "check": "For each version: persist mid-workflow, restart the process, restore, continue to done",
      "how": "Probe script output",
      "proof": "verifier"
    },
    {
      "id": "stale",
      "check": "For each version: a completion from a replaced run is identifiable and can be dropped",
      "how": "Probe script output, case C-stale-completion-dropped",
      "proof": "verifier"
    },
    {
      "id": "choice",
      "check": "The report names the version and pins it",
      "how": "Read the report",
      "proof": "verifier"
    }
  ],
  "cases": [
    "C-stale-completion-dropped"
  ],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No host"
  ],
  "records": [
    "None; probe output"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1000000
  },
  "verifier": "A separate subagent on a different model reruns the probe script and compares.",
  "risks": []
}
```
