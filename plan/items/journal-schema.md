```json
{
  "id": "journal-schema",
  "title": "Define the one journal format every record uses, versioned from the first row",
  "stage": "s0-environment",
  "kind": "build",
  "status": "done",
  "outcome": "A JSON Schema and a tiny append library define the journal: append-only JSONL, one writer per file (a session file, or an item file owned by one thread), every row carrying a version and its source.",
  "why": "v1's store had no schema version, so every format or rule change broke replay, and joining histories took about 15 PRs. Observability, the engine and the pages all read this format, so it comes first and is versioned from row one.",
  "serves": [
    "L-version-event-schema",
    "L-library-mount-slow",
    "L-record-route-at-write",
    "L-placeholders-labelled",
    "L-older-writer-refused",
    "L-one-history",
    "L-effects-acked-once"
  ],
  "depends_on": [
    "repo-skeleton"
  ],
  "inputs": [
    {
      "ref": "plan/ledger/data.md",
      "what": "What v1's store got wrong"
    },
    {
      "ref": "v1 packages/harness/spec/history.schema.json",
      "what": "v1's history row format, the closest prior art"
    }
  ],
  "outputs": [
    {
      "ref": "packages/journal/schema/row.schema.json",
      "what": "Row envelope: v, id, at, kind, source {system, ref}, session, agent, item, state, release, payload"
    },
    {
      "ref": "packages/journal/src/",
      "what": "append(row) to one known file; readFile(path) reads one known file; readAll(root) for offline tools only, never on a hook path; refuse writes from an older release"
    },
    {
      "ref": "docs/journal.md",
      "what": "The kinds vocabulary (session.fingerprint, tool.call, agent.spawn, agent.finish, turn.usage, refusal, hook.run, person.message, person.tap, card.posted, brief.stored, result.stored, ci.result, page.refresh) and how to add a kind"
    }
  ],
  "expect": [
    {
      "id": "schema-tests",
      "check": "Rows of every kind validate; a row missing source or v fails",
      "how": "npm test -w packages/journal",
      "proof": "builder"
    },
    {
      "id": "one-writer",
      "check": "Two sessions appending at once never interleave within a file, and read() returns both in time order",
      "how": "The verifier's own stress test: 100 rows from each of two writers at once on a temp folder",
      "proof": "verifier"
    },
    {
      "id": "older-writer",
      "check": "A writer whose release is older than the newest row's release is refused, naming both versions",
      "how": "The verifier hand-writes a newer-release row and runs an older writer (case C-older-writer-refused)",
      "proof": "verifier"
    },
    {
      "id": "no-scan-on-append",
      "check": "append() opens exactly one file and lists no folder",
      "how": "A test counts fs calls with a stub",
      "proof": "builder"
    },
    {
      "id": "mount",
      "check": "Two sessions appending to one file on the real /mnt/project-files mount at once leave no torn line, and a third session reads both rows within 60 seconds",
      "how": "Three real sessions; the verifier reads the file",
      "proof": "world"
    }
  ],
  "cases": [
    "C-older-writer-refused"
  ],
  "concepts": {
    "adds": [
      "journal row",
      "row kind"
    ],
    "budget": 2
  },
  "non_goals": [
    "No engine events yet (engine rows get kinds in stage 3)",
    "No v1 history import (parity stage, optional)",
    "No database",
    "No upcaster until the first version bump needs one"
  ],
  "records": [
    "Defines the record names every other item uses"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "Where the journal lives in a fresh project (the Library folder chosen at install) is decided in plugin-install"
  ]
}
```

## Notes

Only external inputs and observations are journalled: tool calls, completions, wakes, taps, CI results. Nothing an
agent says about itself becomes a row (ledger L-agents-self-report). The engine's own transitions arrive in stage 3
as rows of kind `engine.transition` with the transition id recorded at write time (ledger L-record-route-at-write).

## Verifier brief

Run the package tests. Write your own two-writer stress test (100 rows each, at once) on a temp folder and confirm
no torn line. Hand-write an old-version row and confirm read() upcasts it without touching the file. Verdict per
Expect id.
