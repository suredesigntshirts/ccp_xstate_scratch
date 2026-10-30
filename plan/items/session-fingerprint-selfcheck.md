```json
{
  "id": "session-fingerprint-selfcheck",
  "title": "Start every session by recording what it runs and checking that its tools work",
  "stage": "s0-environment",
  "kind": "build",
  "status": "merged",
  "outcome": "At session start the plugin journals a fingerprint row and a self-check row, and tells the session plainly if anything it needs is missing or stale.",
  "why": "v1 lost hours to stale installs, rules that hadn't loaded and dead working setups in fresh containers. Anthropic's long-running harness starts each session with a smoke test for the same reason.",
  "serves": [
    "L-version-every-session",
    "L-container-is-ephemeral",
    "L-rules-before-session",
    "L-copies-carry-lineage",
    "L-hook-time-budget",
    "L-library-mount-slow"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "packages/journal",
      "what": "Row format and append()"
    },
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "Budgets and what can be checked at SessionStart"
    }
  ],
  "outputs": [
    {
      "ref": "plugins/harness/hooks/ (SessionStart)",
      "what": "Writes session.fingerprint {claudeCode, model, release, commit, rulesHash, settingsHash, envNamesHash, install} and session.selfcheck {checks: [{name, ok, detail}]}"
    },
    {
      "ref": "docs/selfcheck.md",
      "what": "Each check, what it proves, and how to fix a failure"
    }
  ],
  "expect": [
    {
      "id": "rows",
      "check": "A session start writes exactly one fingerprint and one self-check row",
      "how": "Hook test against a temp journal",
      "proof": "builder"
    },
    {
      "id": "checks",
      "check": "The self-check covers: journal writable, GitHub reachable via REST, allow rules present (hash matches the repo's), plugin not behind main, subagent depth, install marker",
      "how": "Test with stubs makes each check fail once and confirms the row names it",
      "proof": "builder"
    },
    {
      "id": "budget",
      "check": "The hook finishes within half its budget on a cold Library mount, and anything slower runs detached",
      "how": "Timing test on a temp folder plus the measured mount numbers from the probe",
      "proof": "verifier"
    },
    {
      "id": "says-so",
      "check": "A failed check reaches the session as one plain sentence with the fix",
      "how": "Hook output in the failing-check test",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [
      "fingerprint",
      "self-check"
    ],
    "budget": 2
  },
  "non_goals": [
    "Doesn't repair anything; it reports",
    "No network probes beyond GitHub REST"
  ],
  "records": [
    "session.fingerprint",
    "session.selfcheck"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "Which model is actually serving may only be readable later in the session; then the fingerprint row gets a follow-up row, never an edit"
  ],
  "merged_into": "env-bootstrap"
}
```

## Verifier brief

Run the tests. Then start a real headless session (`claude -p --plugin-dir plugins/harness`) against a temp installed
project and read the two rows it wrote. Break one check on purpose (remove the marker's journal folder permission)
and confirm the row and the sentence name it. Verdict per Expect id.
