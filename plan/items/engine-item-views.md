```json
{
  "id": "engine-item-views",
  "title": "Tag every row with its item and step, act on the tripwire, and show items on the page",
  "stage": "s4b-widen",
  "kind": "build",
  "status": "draft",
  "outcome": "Every journal row from an item's actors carries the item and state. The tripwire sends an item to its step-back state. The observe page gains an item view: its workflow, current state, context handles and cost so far.",
  "why": "Cost and time per item were what v1 couldn't explain. With the host knowing which agent serves which item and state, tagging comes free.",
  "serves": [
    "L-attribute-tokens-to-item",
    "L-rework-invisible",
    "L-measure-then-park",
    "L-pages-current-on-demand"
  ],
  "depends_on": [
    "engine-actors",
    "obs-page",
    "obs-time-and-rework",
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "Agent-to-item map held by the host",
      "what": "Which agent serves which item and state"
    }
  ],
  "outputs": [
    {
      "ref": "Capture tags rows with item and state",
      "what": "From the host's map"
    },
    {
      "ref": "Observe page item view",
      "what": "Workflow, state, handles, cost, rounds"
    }
  ],
  "expect": [
    {
      "id": "tagged",
      "check": "Every tool.call from an item's agents carries item and state",
      "how": "Toy run's rows",
      "proof": "verifier"
    },
    {
      "id": "tripwire-acts",
      "check": "Passing the round limit moves the item to replanning",
      "how": "Test",
      "proof": "builder"
    },
    {
      "id": "view",
      "check": "The page shows the toy item's state and cost, matching the rows",
      "how": "Data-layer snapshot test",
      "proof": "verifier"
    }
  ],
  "cases": [
    "C-second-fail-replans"
  ],
  "concepts": {
    "adds": [
      "item view"
    ],
    "budget": 1
  },
  "non_goals": [
    "No cross-item analytics"
  ],
  "records": [
    "Item and state on existing kinds"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": []
}
```

## Verifier brief

Run the toy run (engine-toy-run's script) and read its rows. Confirm item and state on every agent row. Force a third
round and confirm replanning. Verdict per Expect id.
