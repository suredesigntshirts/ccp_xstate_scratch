```json
{
  "id": "second-workflow",
  "title": "Run a second kind of work through a different workflow",
  "stage": "s5-parity",
  "kind": "build",
  "status": "draft",
  "outcome": "A real item of another kind (feature or research) runs through its own workflow, picked at filing, and the journal shows which workflow ran and what it cost compared with the first.",
  "why": "Different workflows for different work is the person's goal for v2. One workflow running doesn't prove the swap works.",
  "serves": [
    "L-rules-in-spec-not-host",
    "L-builder-supplies-gate-inputs",
    "L-measure-then-park"
  ],
  "depends_on": [
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "workflows/",
      "what": "The catalogue"
    }
  ],
  "outputs": [
    {
      "ref": "Workflow selection at filing",
      "what": "Who picked it and how, recorded with its source"
    },
    {
      "ref": "Comparison on the observe page",
      "what": "Cost and asks per workflow"
    }
  ],
  "expect": [
    {
      "id": "selected",
      "check": "The item's first engine row names its workflow and who selected it, and the builder couldn't change it",
      "how": "Rows plus a test that a builder-sent selection is refused",
      "proof": "verifier"
    },
    {
      "id": "ran",
      "check": "The item finished through its workflow's states",
      "how": "engine.transition rows",
      "proof": "verifier"
    }
  ],
  "cases": [
    "C-builder-cannot-change-own-workflow"
  ],
  "concepts": {
    "adds": [
      "workflow selection"
    ],
    "budget": 1
  },
  "non_goals": [
    "No workflow editor"
  ],
  "records": [
    "engine.transition with workflow id and hash"
  ],
  "person_prereqs": [
    "Pick the second item and its workflow with the thread"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 4000000
  },
  "verifier": "A separate subagent checks the two Expect lines from the journal and tries a builder-sent selection.",
  "risks": []
}
```
