```json
{
  "id": "engine-actor-returns",
  "title": "An invoked actor that ends without returning is sent back, or its run fails",
  "stage": "s4-first-real-item",
  "kind": "build",
  "status": "done",
  "outcome": "A bound actor agent that stops without its run's result accepted is told once to call the return tool; if it stops again, its run ends in the actor's error so the item leaves the state instead of waiting forever.",
  "why": "first-real-issue's run 2 (plan/decisions/2026-10-31-first-real-issue-run-2.md): the verify agent ran every check, then handed back with SubagentHandback only. The run stayed open, nothing was waiting, and verifying has no timeout, so the item stalled until the thread nudged the agent by hand.",
  "serves": [
    "L-handback-without-return"
  ],
  "depends_on": [
    "engine-actors"
  ],
  "inputs": [
    {
      "ref": "The run-2 driver and agent logs under /root/.claude/projects (copied to evidence by first-real-issue's verifier)",
      "what": "The failure"
    }
  ],
  "outputs": [
    {
      "ref": "plugins/harness/scripts/actors.mjs SubagentStop",
      "what": "Block once with the return instruction; then the run's error"
    }
  ],
  "expect": [
    {
      "id": "sent-back",
      "check": "A bound actor agent that stops with its run still open is blocked once with an instruction to call the return tool",
      "how": "Hook test on a recorded SubagentStop input",
      "proof": "verifier"
    },
    {
      "id": "fails-after",
      "check": "If it stops again without returning, the run ends in the actor's error and the item leaves the state",
      "how": "Hook and host test",
      "proof": "verifier"
    },
    {
      "id": "real",
      "check": "On a scratch run where the actor is told not to return, the item still leaves the state without a person",
      "how": "A fresh scratch run",
      "proof": "world"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No timeouts on other states"
  ],
  "records": [
    "engine.transition with the actor error"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent on a different model from the builder.",
  "risks": []
}
```

## Verifier brief

Write your own hook tests from the SubagentStop input shape in the run-2 logs. Then run one scratch item whose
verify agent is told to hand back without returning, and read the journal for the error transition. Verdict per
Expect id.
