```json
{
  "id": "parity-cases",
  "title": "Pass every case v1 met, end to end",
  "stage": "s5-parity",
  "kind": "build",
  "status": "draft",
  "outcome": "Every live case in plan/cases/ has a test that drives the real host with stubs for GitHub and the platform, and all pass.",
  "why": "Fragment tests prove the rules. These prove the whole host behaves, which is what 'on par with v1' means.",
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
      "what": "One test per case, named by id"
    }
  ],
  "expect": [
    {
      "id": "all",
      "check": "A test exists for every case id and all pass",
      "how": "A test lists case ids from plan/cases/ and fails on any without a test",
      "proof": "verifier"
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
  "verifier": "A separate subagent writes three of the case tests itself from the case text and compares.",
  "risks": []
}
```
