```json
{
  "id": "s3-engine-skeleton",
  "title": "Run a workflow end to end on XState",
  "order": 3,
  "status": "draft",
  "goal": "The host runs any valid workflow file as an XState machine, starting workers as invoked actors and taking their results as completion events, in a test project.",
  "gate": [
    { "id": "skeleton-runs", "check": "A toy issue runs through the first workflow with no manual reporting by agents", "how": "The journal shows every transition with its source; tests replay it" }
  ]
}
```
