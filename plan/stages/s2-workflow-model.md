```json
{
  "id": "s2-workflow-model",
  "title": "Port the proven skeleton as the first workflow",
  "order": 2,
  "status": "draft",
  "goal": "The XState machine from ccp_machine PR #110 becomes workflows/quick-fix.json on xstate 5.33.3, with the hardest v1 cases as tests on pure transitions.",
  "gate": [
    {
      "id": "cases",
      "check": "Tests for C-verdict-on-old-head, C-push-after-pass and C-second-fail-replans pass on the ported workflow",
      "how": "npm test"
    }
  ]
}
```
The workflow schema, fragments and catalogue the person wants (workflows as data, picked per type of work) come
in s4b-widen, when a second kind of work needs them. The skeleton needs one workflow (plan-review finding 8).
