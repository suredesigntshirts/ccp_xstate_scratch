```json
{
  "id": "obs-page",
  "title": "Give the person one live page that answers where time, tokens and refusals went",
  "stage": "s1-observability",
  "kind": "build",
  "status": "ready",
  "outcome": "A published page reads the journal live and answers, for a day or a thread: where the tokens went, where the time went, what was refused and why, and what was asked of the person. It shows the release and refresh time.",
  "why": "v1's pages went stale for days and were rebuilt by hand. The person wants pages current while they look, with a refresh button and refresh timing recorded. PR #110 itself drifted into 17 commits of page polish, so this page has a hard round budget and no polish rounds without a person ask.",
  "serves": [
    "L-attention-is-the-constraint",
    "L-copies-carry-lineage",
    "L-harness-overhead",
    "L-pages-current-on-demand",
    "L-pages-round-budget"
  ],
  "depends_on": [
    "obs-time-and-rework",
    "obs-refusal-log"
  ],
  "inputs": [
    {
      "ref": "Derived views (time, rework, overhead, attention) and refusal rows",
      "what": "Everything the page shows"
    }
  ],
  "outputs": [
    {
      "ref": "plugins/harness/pages/observe/",
      "what": "The page source, reading the journal through the artifact's files capability"
    },
    {
      "ref": "page.refresh rows",
      "what": "Each refresh's duration and row count"
    }
  ],
  "expect": [
    {
      "id": "answers",
      "check": "For one real session, the data layer gives tokens by agent, time by kind, refusals with rule and person asks, each matching the derived views",
      "how": "Snapshot test of the data layer against the views",
      "proof": "builder"
    },
    {
      "id": "live",
      "check": "The published page reads the journal through the files capability: after the verifier appends a row and presses Refresh, the page shows it, shows the release and a newest row time within 5 minutes of the journal's, writes a page.refresh row, and three numbers on it match views the verifier computes by hand",
      "how": "The published page, opened by the verifier",
      "proof": "world"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [
      "observe page"
    ],
    "budget": 1
  },
  "non_goals": [
    "No item or workflow views yet (engine-item-views adds them after the first real item)",
    "No timers when nobody is viewing",
    "No polish rounds unless the person asks"
  ],
  "records": [
    "page.refresh"
  ],
  "person_prereqs": [
    "Look at the page for one real session and say whether any answer is missing (this is the stage gate, not an Expect line)"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [],
  "after_landing": [
    "Press Refresh on the published page and confirm a page.refresh row"
  ]
}
```

## Verifier brief

Run the data-layer tests. Open the published page, press Refresh, and confirm the release, newest row time and a new
page.refresh row. Compare three numbers on the page with the derived views computed by hand. Verdict per Expect id.
