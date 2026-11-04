```json
{
  "id": "person-setup-sitting",
  "title": "One sitting with the person: place every rule, set up the project, pick the first workflow",
  "stage": "s0-environment",
  "kind": "decision",
  "status": "done",
  "outcome": "In one sitting the person places the full v2 allow-rule set the probe produced, pastes the setup stub, triggers one rebuild, picks the product repo for the first real item, and answers the workflow questions.",
  "why": "The first draft asked the person for allow rules and rebuilds in five separate items, about 16 asks before any value (plan-review finding 7). Rules must exist before sessions start, so collect them all once.",
  "serves": [
    "L-attention-is-the-constraint",
    "L-build-for-next-real-item",
    "L-rules-before-session",
    "L-rules-name-the-work",
    "L-v1-gates-block-v2"
  ],
  "depends_on": [
    "probe-platform-baseline"
  ],
  "inputs": [
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "The full allow-rule set, in plain words"
    },
    {
      "ref": "plan/research/workflows.md, Open questions",
      "what": "The workflow questions"
    }
  ],
  "outputs": [
    {
      "ref": "plan/decisions/person-setup-sitting.md",
      "what": "What was placed and chosen, in the person's words, with the date"
    }
  ],
  "expect": [
    {
      "id": "recorded",
      "check": "The decision file lists the rules placed, the product repo chosen, and answers to the workflow questions",
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
    "person.message, once the journal exists"
  ],
  "person_prereqs": [
    "This item is the person's sitting"
  ],
  "step_back": {
    "max_rounds": 1
  },
  "verifier": "None needed; the record is the person's own words.",
  "risks": []
}
```

## Recommendations prepared for the sitting

- First workflow: **quick-fix** (build, verify, merge), ported from PR #110.
- First real item: a small issue in a **product** repo, not ccp_xstate, so it counts as product work.
- Changing workflows later: describe the change, a thread edits the file and runs the schema check, and the
  builder of an item can never change that item's workflow (case C-builder-cannot-change-own-workflow).
- Agree "done" before the build: only in the feature and long-build workflows.
