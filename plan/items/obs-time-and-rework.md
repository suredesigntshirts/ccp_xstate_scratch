```json
{
  "id": "obs-time-and-rework",
  "title": "Show where wall-clock time goes, how much is rework, and what the harness costs itself",
  "stage": "s1-observability",
  "kind": "build",
  "status": "done",
  "outcome": "Derived views over the journal answer: time working versus waiting (on the person, CI, a wake, a rebuild); rounds, red CI pushes and replans per PR; and tokens spent on harness work against product work. A tripwire row fires when a PR passes its round limit.",
  "why": "PR #72 ran five rounds before the person noticed, and much of v1's effort went into its own bookkeeping without anyone seeing the ratio.",
  "serves": [
    "L-rework-invisible",
    "L-harness-overhead",
    "L-attention-is-the-constraint",
    "L-measure-then-park"
  ],
  "depends_on": [
    "obs-live-capture",
    "obs-person-attention"
  ],
  "inputs": [
    {
      "ref": "Journal rows from obs-live-capture and obs-person-attention",
      "what": "Calls, waits, usage"
    },
    {
      "ref": "GitHub REST (PR commits, check runs)",
      "what": "Pushes and CI results per PR, as ci.result rows"
    }
  ],
  "outputs": [
    {
      "ref": "packages/journal/src/derive/time.js, rework.js, overhead.js",
      "what": "Pure functions over rows; each output names its inputs"
    },
    {
      "ref": "tripwire row",
      "what": "{pr, rounds, limit} when a PR's rounds exceed the limit its item set (default 2)"
    }
  ],
  "expect": [
    {
      "id": "time",
      "check": "A gap with no tool call, turn or wake in progress is labelled waiting with its wake reason, or unknown, never working; on a fixture with a 10-minute idle gap, that gap is not working, and working plus each waiting kind plus unknown sums to wall-clock time",
      "how": "Unit test on a fixture built from a real session, with the idle gap inserted",
      "proof": "builder"
    },
    {
      "id": "rework",
      "check": "For real PRs in this repo (#14, which went red seven times, and two others the verifier picks), derived rounds and red CI runs equal what GitHub's commits and check runs show. ccp_machine #72 is checked the same way once its REST is reachable from a thread",
      "how": "The verifier compares the view with GitHub REST",
      "proof": "world"
    },
    {
      "id": "overhead",
      "check": "Paths listed in a config file count as harness and everything else as product; changing the file moves the split",
      "how": "Unit test with both",
      "proof": "builder"
    },
    {
      "id": "tripwire",
      "check": "A PR passing its round limit emits one tripwire row and no second one for the same limit",
      "how": "The verifier writes its own test from case C-second-fail-replans",
      "proof": "verifier"
    }
  ],
  "cases": [
    "C-second-fail-replans"
  ],
  "concepts": {
    "adds": [
      "derived view",
      "tripwire"
    ],
    "budget": 2
  },
  "non_goals": [
    "The tripwire only records; acting on it is the engine's job in stage 3",
    "Before the engine exists, rounds are counted per PR, not per item"
  ],
  "records": [
    "ci.result",
    "tripwire"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "Classifying waits needs the wake reason; if a wake lacks one, the time is labelled unknown, never guessed"
  ]
}
```

## Verifier brief

Run the tests. Build one fixture yourself from a real PR in this repo (its pushes and check runs from GitHub REST) and
compare the derived rounds with what GitHub shows. Verdict per Expect id.
