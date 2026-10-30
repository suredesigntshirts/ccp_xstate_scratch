```json
{
  "id": "parity-compare",
  "title": "Compare v1 and v2 on the same numbers",
  "stage": "s5-parity",
  "kind": "research",
  "status": "draft",
  "outcome": "A comparison page puts v1 and v2 side by side: concepts (states, guards, context fields, host rules), refusals, person asks, time and tokens per item, and rework.",
  "why": "'Works better' has to be measured, and the decision on v1 needs the numbers.",
  "serves": [
    "L-count-concepts",
    "L-harness-overhead",
    "L-attention-is-the-constraint",
    "L-cost-asymmetry"
  ],
  "depends_on": [
    "parity-cases",
    "second-workflow"
  ],
  "inputs": [
    {
      "ref": "v2 journal",
      "what": "v2 numbers"
    },
    {
      "ref": "v1's one history store and pages in ccp_machine's project (read once, exported as a file)",
      "what": "v1 numbers"
    }
  ],
  "outputs": [
    {
      "ref": "plan/research/parity-compare.md and a page",
      "what": "The comparison, with the method for each number"
    }
  ],
  "expect": [
    {
      "id": "same-method",
      "check": "Each number is computed the same way for both, or the difference is stated",
      "how": "Method column",
      "proof": "verifier"
    },
    {
      "id": "concepts",
      "check": "Concept counts for both are computed by script, not by hand",
      "how": "The script and its output",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No recommendation on v1; that's the decision item's job"
  ],
  "records": [
    "None beyond the files"
  ],
  "person_prereqs": [
    "Export v1's numbers from the ccp_machine project (a thread there can do it)"
  ],
  "step_back": {
    "max_rounds": 1
  },
  "verifier": "A separate subagent recomputes three numbers from the sources.",
  "risks": [
    "v1 data lives in another project's Library; it has to be exported, since this project can't read it"
  ]
}
```
