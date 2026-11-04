```json
{
  "id": "obs-briefs-and-results",
  "title": "Keep every worker's brief and result as a durable file",
  "stage": "s1-observability",
  "kind": "build",
  "status": "merged",
  "outcome": "Every subagent's brief and final answer is stored as a file next to the journal, and the agent.spawn and agent.finish rows link to them by hash.",
  "why": "In v1, what a worker was asked and what it returned lived only in a scratchpad or the session log. Nobody could audit it after the container was reclaimed.",
  "serves": [
    "L-briefs-durable",
    "L-container-is-ephemeral"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "packages/journal",
      "what": "Row format and storage root"
    }
  ],
  "outputs": [
    {
      "ref": "<journal root>/blobs/<sha256>",
      "what": "Brief and result texts, stored once by content hash"
    },
    {
      "ref": "brief.stored, result.stored rows",
      "what": "Hash, size, agentId"
    }
  ],
  "expect": [
    {
      "id": "stored",
      "check": "A test session's subagent brief and final answer exist as blobs whose hashes match the rows",
      "how": "Script recomputes sha256",
      "proof": "verifier"
    },
    {
      "id": "dedup",
      "check": "The same brief twice is stored once",
      "how": "Test",
      "proof": "builder"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [
      "blob"
    ],
    "budget": 1
  },
  "non_goals": [
    "No redaction beyond what capture already applies; briefs shouldn't hold secrets"
  ],
  "records": [
    "brief.stored",
    "result.stored"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [],
  "merged_into": "obs-live-capture"
}
```

## Verifier brief

Run a headless session that spawns one subagent. Recompute the hashes of the stored brief and result and match them to
the rows. Verdict per Expect id.
