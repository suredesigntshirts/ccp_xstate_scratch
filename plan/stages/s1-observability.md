```json
{
  "id": "s1-observability",
  "title": "Observe every call, refusal, wait and person ask before any XState work",
  "order": 1,
  "status": "draft",
  "goal": "Every tool call, subagent, wake, refusal, person ask and turn usage is in the journal as it happens, checked against the session logs and GitHub, and one live page answers where tokens, time and refusals went. The engine is built under this observation from its first commit.",
  "gate": [
    {
      "id": "live-journal",
      "check": "A test session's journal holds a row for every tool call in the session's own log, with no salvage step",
      "how": "obs-journal-vs-world run on one real session in the v2 project reports 0 missing calls"
    },
    {
      "id": "answers",
      "check": "The person reads the observe page for the sessions that built this stage and names no missing answer",
      "how": "The person's reply, recorded in plan/decisions/"
    }
  ]
}
```

The person chose full observability before XState on 30 Oct (plan/decisions/2026-10-30-observability-first.md),
over the thin path the independent review proposed. The cost is about five more items before the first real issue.
The gain is that the engine and the first real item are measured from their first commit, so the retro reads numbers
instead of recollection. The round budget on obs-page (ledger L-pages-round-budget) is the guard against this stage
repeating PR #110's page drift.
