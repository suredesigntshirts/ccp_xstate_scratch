```json
{
  "id": "fix-workflow-pinned",
  "title": "Pin an item to the workflow and hash it was filed with",
  "stage": "s5-parity",
  "kind": "build",
  "status": "draft",
  "outcome": "An item records its workflow's name and file hash when it starts, and the host runs that workflow and hash for the item's life, refusing a call that names another workflow or finds the file changed.",
  "why": "parity-cases found the host loads the workflow named on each call from the repo's workflows/ and checks only that replay reaches the recorded snapshot hashes, so a changed workflow that replays the same runs for the item (plan/decisions/2026-11-01-parity-cases-gaps.md). Done when packages/engine/test/parity/C-builder-cannot-change-own-workflow.test.js passes and its gaps.json entry is gone; the parity-cases verifier's characterisation test verify/parity-cases/C-builder-cannot-change-own-workflow.gap.test.mjs asserts today's broken behaviour, so this item deletes it in the same PR.",
  "serves": [
    "L-builder-supplies-gate-inputs"
  ],
  "depends_on": [
    "parity-cases"
  ],
  "cases": [
    "C-builder-cannot-change-own-workflow"
  ]
}
```
