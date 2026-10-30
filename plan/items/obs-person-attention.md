```json
{
  "id": "obs-person-attention",
  "title": "Measure what the harness asks of the person",
  "stage": "s1-observability",
  "kind": "build",
  "status": "ready",
  "outcome": "Every message and tap from the person, every card and post to them, and how long each card waited is in the journal.",
  "why": "The person's attention is the system's constraint. v1 recorded the person's messages but couldn't say what each item cost them, or how long work waited on them.",
  "serves": [
    "L-attention-is-the-constraint",
    "L-person-interactions-logged",
    "L-message-caps",
    "L-never-idle-on-person"
  ],
  "depends_on": [
    "obs-live-capture"
  ],
  "inputs": [
    {
      "ref": "Wake envelopes captured by obs-live-capture",
      "what": "Person messages and taps arrive as wakes"
    }
  ],
  "outputs": [
    {
      "ref": "person.message, person.tap, card.posted, post.sent rows",
      "what": "With thread, message id, and for taps the card and option"
    },
    {
      "ref": "packages/journal/src/derive/attention.js",
      "what": "Per day and per thread: messages, taps, cards, posts, card wait times, and posts against the hourly caps"
    }
  ],
  "expect": [
    {
      "id": "rows",
      "check": "A test thread with one person message, one card and one tap yields the three rows linked by card id",
      "how": "The verifier builds its own fixture from one real wake envelope with a tap",
      "proof": "verifier"
    },
    {
      "id": "wait",
      "check": "Card wait time equals tap time minus post time",
      "how": "Unit test",
      "proof": "builder"
    },
    {
      "id": "caps",
      "check": "The derived view flags an hour with more than 20 posts in one thread",
      "how": "Unit test",
      "proof": "builder"
    },
    {
      "id": "rows-real",
      "check": "For the person-setup-sitting thread, every message and tap the person made there appears as a row",
      "how": "The verifier counts them with read_thread and compares",
      "proof": "world"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [
      "attention view"
    ],
    "budget": 1
  },
  "non_goals": [
    "Doesn't measure what the person read (the platform doesn't record it)"
  ],
  "records": [
    "person.message",
    "person.tap",
    "card.posted",
    "post.sent"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "A mod sees the thread's own tool calls (post_message, request_decision) but a tap arrives as a wake; both paths are needed"
  ]
}
```

## Verifier brief

Run the tests. Build your own fixture from one real wake envelope with a tap and confirm the link to its card. Verdict
per Expect id.
