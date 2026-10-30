```json
{
  "id": "plan-independent-review",
  "title": "Have someone who didn't write the plan review it before any build starts",
  "stage": "s0-environment",
  "kind": "research",
  "status": "done",
  "outcome": "An independent reviewer, given the plan and v1's lessons but not the author's reasoning, reports what is missing, wrong or over-built, and each finding is answered by a plan change or a written reason.",
  "why": "v1's landing-gate plan, written by the driving lead, was weaker than what already existed; only an independent read caught it. The person asked: did you or a subagent write it?",
  "serves": [
    "L-plans-need-independent-read",
    "L-no-trust-boundary"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "plan/",
      "what": "The whole plan"
    }
  ],
  "outputs": [
    {
      "ref": "plan/research/plan-review.md",
      "what": "Findings, and the answer to each"
    }
  ],
  "expect": [
    {
      "id": "answered",
      "check": "Every finding has a plan change or a written reason",
      "how": "Read plan-review.md",
      "proof": "verifier"
    },
    {
      "id": "checks",
      "check": "The plan check passes after the changes",
      "how": "node plan/check.mjs --coverage",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "Not a review of v1"
  ],
  "records": [
    "None; the journal doesn't exist yet"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2
  },
  "verifier": "The review is itself the independent check; the person reads the answers.",
  "risks": []
}
```
