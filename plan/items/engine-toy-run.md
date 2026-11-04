```json
{
  "id": "engine-toy-run",
  "title": "Run a toy issue through the first workflow end to end in the test project",
  "stage": "s3-engine-skeleton",
  "kind": "build",
  "status": "done",
  "outcome": "A toy issue in a scratch repo goes from filed to merged through the person's chosen workflow, with no agent-sent lifecycle events, and the journal check reports nothing missing.",
  "why": "This is the stage gate: the walking skeleton working end to end, with real actors, before a real issue.",
  "serves": [
    "L-walking-skeleton-control-first",
    "L-build-for-next-real-item",
    "L-checks-against-world"
  ],
  "depends_on": [
    "engine-actors",
    "engine-effects"
  ],
  "inputs": [
    {
      "ref": "plan/decisions/person-setup-sitting.md",
      "what": "The product repo; the toy issue goes in a scratch repo beside it"
    }
  ],
  "outputs": [
    {
      "ref": "scripts/toy-run.sh and a scratch repo issue",
      "what": "Repeatable toy run"
    },
    {
      "ref": "plan/research/toy-run.md",
      "what": "What ran, the numbers, and anything surprising"
    }
  ],
  "expect": [
    {
      "id": "merged",
      "check": "The toy PR is merged at the verified sha",
      "how": "GitHub plus the journal, run by the verifier on its own",
      "proof": "world"
    },
    {
      "id": "complete",
      "check": "Every tool call in the toy run's sessions has a journal row",
      "how": "Compare the sessions' event logs with the journal (by hand or script)",
      "proof": "verifier"
    },
    {
      "id": "sources",
      "check": "Every engine.transition row's source is a wake, completion or timer",
      "how": "Query the rows",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "Not a real issue"
  ],
  "records": [
    "All of the above, for one item"
  ],
  "person_prereqs": [
    "Create the scratch repo and attach it to the v2 project"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 3000000
  },
  "verifier": "A separate subagent on a different model reruns the toy run and checks the three Expect lines itself.",
  "risks": []
}
```

## Verifier brief

Rerun the toy run yourself from a fresh scratch issue, without reading the builder's report first. Check the
merge sha against the verdict sha on GitHub, compare every session's event log with the journal, and query every
engine.transition row's source. Write verify/engine-toy-run/verdict.json in your own commit.
