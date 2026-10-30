```json
{
  "id": "obs-journal-vs-world",
  "title": "Check the journal against the session logs and GitHub",
  "stage": "s1-observability",
  "kind": "build",
  "status": "ready",
  "outcome": "One command compares the journal with a session's own event log and with GitHub's PRs and merges, and lists anything missing or unexplained.",
  "why": "v1's checks compared the store with itself and passed while the world disagreed. A check against outside facts is what makes the journal trustworthy.",
  "serves": [
    "L-checks-against-world",
    "L-record-live-not-salvage",
    "L-facts-from-source"
  ],
  "depends_on": [
    "obs-live-capture"
  ],
  "inputs": [
    {
      "ref": "list_events for a session id",
      "what": "The platform's record of the session"
    },
    {
      "ref": "GitHub REST: closed PRs with merged_at, head sha",
      "what": "What actually merged"
    }
  ],
  "outputs": [
    {
      "ref": "packages/journal/bin/journal-check.js",
      "what": "Reports: tool calls missing from the journal; merges on GitHub with no journal row; rows whose source can't be found"
    }
  ],
  "expect": [
    {
      "id": "session-diff",
      "check": "On a test session, the report shows 0 missing calls; after deleting one row, it shows exactly that call",
      "how": "A real session in the v2 project: run the check, delete one tool.call row in a copy, run again",
      "proof": "world"
    },
    {
      "id": "merge-diff",
      "check": "A PR merged on GitHub with no journal row is listed",
      "how": "Fixture of GitHub responses",
      "proof": "builder"
    },
    {
      "id": "real-merge",
      "check": "A scratch PR merged by hand through GitHub REST, with no journal row, is listed by the check",
      "how": "A scratch repo",
      "proof": "world"
    }
  ],
  "cases": [
    "C-merge-outside-host-detected"
  ],
  "concepts": {
    "adds": [
      "journal check"
    ],
    "budget": 1
  },
  "non_goals": [
    "Doesn't repair the journal; gaps get labelled placeholder rows only by a separate, explicit command"
  ],
  "records": [
    "A check row with the counts"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "list_events retention is unknown; run the check soon after sessions end"
  ]
}
```

## Verifier brief

Pick a recent real session in the v2 project. Run the check, delete one tool.call row in a copy and run again.
Confirm only that call shows up. Verdict per Expect id.
