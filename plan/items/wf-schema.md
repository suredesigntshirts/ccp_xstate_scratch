```json
{
  "id": "wf-schema",
  "title": "Define a workflow as a data file the engine can run",
  "stage": "s4b-widen",
  "kind": "build",
  "status": "draft",
  "outcome": "One JSON Schema describes a workflow (states, the actor each state invokes, gates as preconditions, cards, limits, fragments it reuses), and a pure compiler turns a valid file into an XState machine config.",
  "why": "The person wants workflows that are easy to change and picked per type of work. v1's rules drifted into host code and skill prose; a workflow that is only data, run by a fixed engine, keeps every rule visible and testable.",
  "serves": [
    "L-rules-in-spec-not-host",
    "L-count-concepts",
    "L-theory-written",
    "L-xstate-version",
    "L-expect-format-one-owner",
    "L-dynamic-workflows-limits",
    "L-expect-checkable-before-accept"
  ],
  "depends_on": [
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "plan/research/workflows.md",
      "what": "What a workflow must be able to express"
    },
    {
      "ref": "ccp_machine PR #110 packages/orchestrator/spec/item.machine.json",
      "what": "The skeleton machine with 9 context fields and precondition guards"
    },
    {
      "ref": "Stately Agent docs (machines-as-data, human-in-the-loop) in v1's Library external-docs/stately.ai/",
      "what": "Dot-path guards and meta.interaction"
    }
  ],
  "outputs": [
    {
      "ref": "packages/workflow/schema/workflow.schema.json",
      "what": "The workflow file format"
    },
    {
      "ref": "packages/workflow/src/compile.js",
      "what": "Pure: workflow file -> XState config; no I/O"
    },
    {
      "ref": "docs/workflows.md",
      "what": "How to read and write a workflow, pointing at the schema"
    }
  ],
  "expect": [
    {
      "id": "two-validate",
      "check": "Two different sample workflows validate and compile",
      "how": "npm test -w packages/workflow",
      "proof": "verifier"
    },
    {
      "id": "refuses-bad",
      "check": "A workflow whose invoke has no onError, or a state that can't reach a final state, is refused with the state named",
      "how": "Tests with two broken samples",
      "proof": "builder"
    }
  ],
  "cases": [
    "C-missing-expect-fails-closed"
  ],
  "concepts": {
    "adds": [
      "workflow file",
      "actor spec",
      "precondition guard",
      "fragment"
    ],
    "budget": 4
  },
  "non_goals": [
    "No runtime, host or effects",
    "No visual editor"
  ],
  "records": [
    "None at build time; the engine journals the workflow id and its hash per item in stage 3"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "Expressiveness: if a researched workflow can't be written in the schema, the schema grows by one concept, recorded with the reason"
  ]
}
```

## Verifier brief

Run the tests. Write a third workflow yourself from `plan/research/workflows.md` (the research one) using only
docs/workflows.md, and confirm it validates and compiles. If you couldn't express something, that's a finding. Verdict
per Expect id.
