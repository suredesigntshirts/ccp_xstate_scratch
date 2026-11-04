```json
{
  "id": "parity-cases",
  "title": "Pass every case v1 met, end to end",
  "stage": "s5-parity",
  "kind": "build",
  "status": "done",
  "outcome": "Every live case in plan/cases/ has a test under packages/engine/test/parity/, named by its id, that drives the real host (restore and offer, bin/host.js, the journal and its check) with stubs only for GitHub and the platform, and all of them pass, except a case the engine is known not to meet: that one is listed in packages/engine/test/parity/gaps.json with the live fix item that will meet it.",
  "why": "Fragment tests prove the rules. These prove the whole host behaves, which is what 'on par with v1' means. A case the engine doesn't meet yet is not hidden and not built here (non_goals): it is named, with its own fix item, so the s5 gate shows what is left (plan/decisions/2026-11-01-parity-cases-gaps.md).",
  "serves": [
    "L-checks-against-world",
    "L-missing-input-passes"
  ],
  "depends_on": [
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "plan/cases/",
      "what": "The cases"
    }
  ],
  "outputs": [
    {
      "ref": "packages/engine/test/parity/",
      "what": "One test per case, named by id, and gaps.json for the cases a fix item will meet"
    },
    {
      "ref": "packages/engine/test/parity/cases.test.js",
      "what": "Lists case ids from plan/cases/ and fails on any with neither a test nor a gaps.json entry naming a live item that cites the case"
    }
  ],
  "expect": [
    {
      "id": "all",
      "check": "Every case id in plan/cases/ has packages/engine/test/parity/<id>.test.js or a gaps.json entry naming a live plan item whose cases list it, never both, and removing either makes the listing test fail",
      "how": "Run the listing test, then delete one test file and one gaps entry in a scratch copy and see it fail",
      "proof": "verifier"
    },
    {
      "id": "host",
      "check": "Each parity test drives the host itself: an item restored from its journal file and offered events through offer(), applyEvent() or bin/host.js, or the journal and its check for the journal cases; GitHub and the platform are the only stubs, as wake text, a local GitHub server or a client object",
      "how": "Read every parity test",
      "proof": "verifier"
    },
    {
      "id": "independent",
      "check": "Three case tests the verifier writes itself from the case text alone agree with the builder's on the same cases",
      "how": "A separate subagent picks three cases, writes its tests without reading the builder's, and runs both",
      "proof": "verifier"
    },
    {
      "id": "gaps-real",
      "check": "Each case in gaps.json really fails on the engine at the head: a test written from the case text goes red",
      "how": "The verifier's own test per gap case",
      "proof": "verifier"
    },
    {
      "id": "ci",
      "check": "The PR's ci check runs the parity suite at the head sha and it is green",
      "how": "The ci check run on GitHub for the head sha",
      "proof": "world"
    }
  ],
  "cases": [
    "C-builder-cannot-change-own-workflow",
    "C-claimed-pr-not-on-github",
    "C-duplicate-wake-no-double-effect",
    "C-finish-closes-waits",
    "C-merge-outside-host-detected",
    "C-missing-expect-fails-closed",
    "C-older-writer-refused",
    "C-pass-carries-to-merge-of-main",
    "C-push-after-pass",
    "C-red-ci-back-to-building",
    "C-refused-action-not-retried",
    "C-second-fail-replans",
    "C-stale-completion-dropped",
    "C-stand-in-picks-legal-event",
    "C-two-hosts-one-item",
    "C-verdict-on-old-head",
    "C-waiting-does-not-stall"
  ],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No new behaviour; a failing case becomes its own fix item"
  ],
  "records": [
    "ci.result"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 3000000
  },
  "verifier": "A separate subagent, using the Verifier brief below, writes three of the case tests itself from the case text and compares.",
  "risks": [
    "An item whose start is refused (C-missing-expect-fails-closed) keeps the refusal row in its file, so the same item id can never start later, even with Expect lines: the refused start fails closed for good. Noted for parity-compare; not a case gap.",
    "No real wake has shown how the platform reports a push to a PR, so C-push-after-pass offers pr.pushed with a github source as the host takes it; how a push reaches the host from a real wake is for parity-compare to note, not this item."
  ]
}
```

## Verifier brief

Read plan/cases/ and packages/engine/test/parity/. Run the listing test, then in a scratch copy delete one parity test
and one gaps.json entry and confirm it fails each time. Read every parity test and confirm it drives the host (restore
and offer, applyEvent, bin/host.js, or the journal and its check) and stubs nothing but GitHub and the platform. Pick
three cases not in gaps.json, including C-duplicate-wake-no-double-effect, write their tests yourself from the case text without
reading the builder's, run both, and say where they disagree. For each case in gaps.json write a test from its case text
and show it red on the head. Read the ci check run at the head sha on GitHub. Verdict per Expect id.
