```json
{
  "id": "engine-cards-standin",
  "title": "Turn waiting states into cards that the stand-in or the person answers",
  "stage": "s4b-widen",
  "kind": "build",
  "status": "draft",
  "outcome": "A waiting state's declared card is posted through the project's decision tool. Under the person's grant a stand-in on another model answers with one of the legal events; one-way doors outside the work wait for the person. Finishing an item closes its waits.",
  "why": "v1 had three machines for decisions, grants and audits (34 context fields), cards piled up overnight, and finished items left decisions in the person's inbox. One pattern, a state that declares its card, covers all of it.",
  "serves": [
    "L-stand-in-decides",
    "L-never-idle-on-person",
    "L-item-finish-clears-inbox",
    "L-attention-is-the-constraint",
    "L-builder-supplies-gate-inputs"
  ],
  "depends_on": [
    "engine-effects",
    "engine-actors",
    "obs-person-attention",
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "packages/workflow/fragments/card-wait.json",
      "what": "The fragment"
    },
    {
      "ref": "v1 autoMode.allow stand-in rule and grant notes",
      "what": "The person's grant, to restate as data"
    }
  ],
  "outputs": [
    {
      "ref": "packages/engine/src/cards.js",
      "what": "Post a card from meta.interaction; map a tap to its event"
    },
    {
      "ref": "grants.json in the harness folder",
      "what": "What the stand-in may decide, set by the person"
    }
  ],
  "expect": [
    {
      "id": "legal-only",
      "check": "A stand-in answer that isn't a legal event in that state is refused",
      "how": "Test for case C-stand-in-picks-legal-event",
      "proof": "builder"
    },
    {
      "id": "closes",
      "check": "Cancelling or finishing an item closes its open card",
      "how": "Test for case C-finish-closes-waits",
      "proof": "builder"
    },
    {
      "id": "no-stall",
      "check": "With one item waiting on the person, another item still advances and a wake is scheduled",
      "how": "Test for case C-waiting-does-not-stall",
      "proof": "builder"
    },
    {
      "id": "grant-source",
      "check": "Each stand-in answer is journalled with the grant entry that covered it",
      "how": "Test",
      "proof": "builder"
    }
  ],
  "cases": [
    "C-stand-in-picks-legal-event",
    "C-finish-closes-waits",
    "C-waiting-does-not-stall"
  ],
  "concepts": {
    "adds": [
      "card",
      "grant"
    ],
    "merges": [
      "v1's decision, grant and audit machines"
    ],
    "budget": 2
  },
  "non_goals": [
    "No learning the person's taste yet"
  ],
  "records": [
    "card.posted",
    "person.tap",
    "engine.transition with grant"
  ],
  "person_prereqs": [
    "Write the first grants.json with the thread (a short conversation)"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "Concurrency above 1 is needed for the no-stall case; the workflow must allow 2 for that test"
  ]
}
```
## Verifier brief

Write your own tests for the three named cases from their text, with a stub for the decision tool and a recorded
tap fixture. No real card is posted. Verdict per Expect id.
