```json
{
  "id": "engine-item-views",
  "title": "Tag every row with its item and step, act on the tripwire, and show items on the page",
  "stage": "s4b-widen",
  "kind": "build",
  "status": "done",
  "outcome": "Every journal row from an item's actors carries the item and state. The tripwire sends an item to its step-back state. The observe page gains an item view: its workflow, current state, context handles and cost so far.",
  "why": "Retro findings 2 and 3 (plan/research/retro-first-item.md): the first real item's person wait, card and refusals sat in the owning thread, so its own view showed 0 s on the person, and one agent's two finish rows overcount tokens by 9% if summed. Cost and time per item were what v1 couldn't explain. With the host knowing which agent serves which item and state, tagging comes free.",
  "serves": [
    "L-attribute-tokens-to-item",
    "L-rework-invisible",
    "L-measure-then-park",
    "L-pages-current-on-demand",
    "L-item-view-spans-sessions",
    "L-agent-finish-twice"
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
      "id": "finish-once",
      "check": "An agent with several agent.finish rows counts once in the item's tokens: its last row, not the sum",
      "how": "Test on a journal with the brief agent's two cumulative finish rows from the first real run",
      "proof": "verifier"
    },
    {
      "id": "spans-sessions",
      "check": "The item view counts the person wait and card of the item's ask even when they happen in the thread that owns the item, not the driver session",
      "how": "Data-layer test on a journal where the card and the answer are rows in another session's file",
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
      "check": "On a fresh scratch toy run, the page's item view shows the item's state, cost and person wait, and they match the journal rows",
      "how": "A fresh scratch run, then the page's data layer read against the rows",
      "proof": "world"
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

Run the toy run (engine-toy-run's script) and read its rows. Confirm item and state on every agent row. Build your own
journal with two cumulative finish rows for one agent, and one with the card and answer in another session's file, and
check the item view's numbers by hand. Force a third round and confirm replanning. Verdict per Expect id.
