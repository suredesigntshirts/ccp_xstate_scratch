```json
{
  "id": "first-real-issue",
  "title": "Finish one small real issue with v2 in a real Projects thread",
  "stage": "s4-first-real-item",
  "kind": "build",
  "status": "ready",
  "outcome": "A small real issue, chosen with the person, goes from filed to merged through v2, observed end to end, with the person asked only what the workflow says to ask.",
  "why": "The constraint after the skeleton is real use. A toy can't show waits on CI, real review findings or real refusals.",
  "serves": [
    "L-attention-is-the-constraint",
    "L-build-for-next-real-item",
    "L-checks-against-world",
    "L-first-item-is-product"
  ],
  "depends_on": [
    "engine-toy-run"
  ],
  "inputs": [
    {
      "ref": "A small real issue in the product repo chosen in person-setup-sitting (not ccp_xstate)",
      "what": "The work; it must count as product work"
    }
  ],
  "outputs": [
    {
      "ref": "The merged PR",
      "what": "The work done"
    },
    {
      "ref": "The item's journal and its observe-page view",
      "what": "The record"
    }
  ],
  "expect": [
    {
      "id": "merged",
      "check": "The PR is merged at the verified sha by the host",
      "how": "GitHub plus the journal",
      "proof": "world"
    },
    {
      "id": "complete",
      "check": "Every tool call in the sessions that served the item has a journal row",
      "how": "Compare the sessions' event logs with the journal",
      "proof": "verifier"
    },
    {
      "id": "asks",
      "check": "Every post_message, request_decision and card call in the item's sessions (from tool.call rows, not only card.posted) is one the workflow declares; a workflow that declares none shows none",
      "how": "The verifier compares tool.call rows with the workflow's declared asks",
      "proof": "verifier"
    },
    {
      "id": "product-ci",
      "check": "The product repo's own CI is green at the merged sha, and the change does what its issue asked",
      "how": "The verifier reads the issue, the diff and the CI run on GitHub",
      "proof": "world"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No fixes to v2 inside this item; problems found become new items"
  ],
  "records": [
    "Everything, for one real item"
  ],
  "person_prereqs": [
    "Pick the issue with the thread"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 4000000
  },
  "verifier": "The workflow's own verifier for the work. For this plan item, a separate subagent checks the three Expect lines from GitHub and the journal.",
  "risks": []
}
```

## Verifier brief

Read the issue and the product repo's tests before the PR. Check the merge sha against the verdict sha on GitHub,
the product CI at the merged sha, and whether the diff does what the issue asked. Compare every session's event log
with the journal, and every ask the person saw with the workflow's declared asks. Write
verify/first-real-issue/verdict.json in your own commit.
