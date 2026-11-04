```json
{
  "id": "clean-room-install-test",
  "title": "Prove in CI that a fresh install works from the plugin alone",
  "stage": "s0-environment",
  "kind": "build",
  "status": "done",
  "outcome": "Every release runs a clean-room job: empty HOME, empty project folder, setup script, install, a headless session, and the self-check passes.",
  "why": "The product installs on fresh projects, but we only ever run in our own. A clean room catches anything that quietly depends on this project's leftovers.",
  "serves": [
    "L-repo-skills-dont-load",
    "L-checks-against-world",
    "L-container-is-ephemeral"
  ],
  "depends_on": [
    "self-update-by-version"
  ],
  "inputs": [
    {
      "ref": "infra/cloud-environment/setup.sh, plugins/harness",
      "what": "What gets installed"
    }
  ],
  "outputs": [
    {
      "ref": ".github/workflows/clean-room.yml",
      "what": "The job, run on release and on demand"
    },
    {
      "ref": "docs/selfcheck.md (section)",
      "what": "How to read a clean-room failure"
    }
  ],
  "expect": [
    {
      "id": "green",
      "check": "The clean-room job passes on the current release",
      "how": "The job also runs on PRs that touch plugins/ or infra/, so it ran on this PR",
      "proof": "verifier"
    },
    {
      "id": "catches",
      "check": "Removing a file the plugin needs makes the job fail with the self-check naming it",
      "how": "A scratch PR that deletes one plugin file",
      "proof": "world"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "Not a test of a real Projects thread; the s0 gate fresh-install does that"
  ],
  "records": [
    "ci.result for the clean-room job"
  ],
  "person_prereqs": [
    "Add an API key secret for headless claude in CI, if the job runs a real session; otherwise the job runs the hooks without a model"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "A real headless session in CI needs a key and costs tokens; running the hook scripts directly may be enough"
  ]
}
```

## Verifier brief

Read the job and confirm HOME and the project folder start empty. Confirm the job ran green on the PR, then open the
scratch PR's red run and confirm the self-check names the missing file. Verdict per Expect id.
