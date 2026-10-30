```json
{
  "id": "wf-catalogue",
  "title": "Write the first workflows as data, from the research",
  "stage": "s4b-widen",
  "kind": "build",
  "status": "draft",
  "outcome": "quick-fix, feature, research and long-build exist as validated workflow files built from the fragments, each with a one-paragraph why and the research it follows.",
  "why": "The person picks from real options, not descriptions. Writing them also shows whether the schema can express what the research found.",
  "serves": [
    "L-build-for-next-real-item",
    "L-issues-state-problems",
    "L-verifier-independent",
    "L-parallel-only-disjoint"
  ],
  "depends_on": [
    "wf-fragments",
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "plan/research/workflows.md",
      "what": "The catalogue and what each takes from which harness"
    }
  ],
  "outputs": [
    {
      "ref": "workflows/{quick-fix,feature,research,long-build}.json",
      "what": "Workflow files"
    },
    {
      "ref": "workflows/README.md",
      "what": "When to use each, its cost in rounds and person asks"
    }
  ],
  "expect": [
    {
      "id": "valid",
      "check": "All four validate and compile",
      "how": "npm test",
      "proof": "verifier"
    },
    {
      "id": "traced",
      "check": "Each workflow's README entry names the research rows it follows",
      "how": "Read it",
      "proof": "verifier"
    },
    {
      "id": "concurrency",
      "check": "Every workflow sets concurrency 1 unless its README says why not",
      "how": "Test",
      "proof": "builder"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "Not run yet; the engine stage runs the one the person picks"
  ],
  "records": [
    "None at build time"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": []
}
```

## Verifier brief

Run the tests. For each workflow, read only its README entry and the research doc, then read the file and say whether
it does what the entry claims. Verdict per Expect id.
