```json
{
  "id": "wf-choose-first",
  "title": "The person picks the first workflow and how workflows get changed",
  "stage": "s2-workflow-model",
  "kind": "decision",
  "status": "merged",
  "outcome": "The person's choices are recorded: which workflow the engine runs first, whether they edit workflow files or describe changes for a thread to make, and when builder and verifier agree 'done' before a build.",
  "why": "These change the person's goal and how they work with the harness, so they're the person's call. The plan prepared the options and a recommendation.",
  "serves": [
    "L-attention-is-the-constraint",
    "L-build-for-next-real-item"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "workflows/README.md",
      "what": "The options with costs"
    },
    {
      "ref": "plan/research/workflows.md, Open questions",
      "what": "The three questions"
    }
  ],
  "outputs": [
    {
      "ref": "plan/decisions/wf-choose-first.md",
      "what": "The choices, in the person's words, with the date"
    }
  ],
  "expect": [
    {
      "id": "recorded",
      "check": "The decision file holds an answer to all three questions",
      "how": "Read it",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No build"
  ],
  "records": [
    "person.tap or person.message for the answer"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 1
  },
  "verifier": "None needed; the record is the person's own words.",
  "risks": [],
  "merged_into": "person-setup-sitting"
}
```

## Recommendation (prepared for the card)

- First workflow: **quick-fix** (build, verify, merge). It is the smallest that still has a separate verifier.
- Changing workflows: **describe the change**, and a thread edits the file, runs the schema check and shows the diff.
  Direct editing stays possible.
- Agree "done" first: **only in feature and long-build**. It costs a round, and quick fixes don't need it.
