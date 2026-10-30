```json
{
  "id": "setup-script",
  "title": "Install everything a v2 session needs from the repo when the container is built",
  "stage": "s0-environment",
  "kind": "build",
  "status": "merged",
  "outcome": "A five-line stub pasted once into the project's environment runs the repo's setup script, which installs the plugin, sets subagent depth 3, writes v2's allow rules and logs what it did.",
  "why": "Repo settings and skills don't load in Projects threads, rules must exist before a session starts, and a pasted full script goes stale. v1 learned each of these the hard way.",
  "serves": [
    "L-setup-script-stub",
    "L-subagent-depth",
    "L-repo-skills-dont-load",
    "L-rules-before-session",
    "L-rules-name-the-work",
    "L-container-is-ephemeral"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "ccp_machine infra/cloud-environment/ (paste-me.sh, setup.sh)",
      "what": "v1's working script, to adapt"
    },
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "Which rules and settings the probe showed are needed"
    }
  ],
  "outputs": [
    {
      "ref": "infra/cloud-environment/paste-me.sh",
      "what": "The stub the person pastes"
    },
    {
      "ref": "infra/cloud-environment/setup.sh",
      "what": "Installs the plugin into ~/.claude, merges .claude/settings.json (env, permissions, autoMode.allow) into ~/.claude/settings.json, writes a setup log"
    },
    {
      "ref": ".claude/settings.json",
      "what": "v2's allow rules in plain words describing v2's actions"
    }
  ],
  "expect": [
    {
      "id": "clean-home",
      "check": "setup.sh run against an empty HOME produces the expected ~/.claude files and is safe to run twice",
      "how": "test/setup.test.js runs it twice in a temp HOME and diffs the results",
      "proof": "builder"
    },
    {
      "id": "no-values-logged",
      "check": "The setup log names environment variables but never their values",
      "how": "The test sets a secret-looking variable and greps the log for its value",
      "proof": "verifier"
    },
    {
      "id": "rules-plain",
      "check": "Every autoMode.allow entry names a v2 action and who may do it, with no v1 terms (lead, store, stand-in ladder)",
      "how": "A test checks the entries against a list of v1 terms",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [
      "setup script"
    ],
    "budget": 1
  },
  "non_goals": [
    "No network probes in the setup audit (the person removed them in v1)",
    "No harness behaviour"
  ],
  "records": [
    "setup.log in the container, summarised into the session fingerprint by session-fingerprint-selfcheck"
  ],
  "person_prereqs": [
    "Paste infra/cloud-environment/paste-me.sh into the v2 project's environment setup script after this lands, then start a fresh thread"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "Allow rules the probe didn't cover may still be refused; the self-check reports that rather than guessing"
  ],
  "merged_into": "env-bootstrap"
}
```

## Verifier brief

Run `npm test`. Then run setup.sh yourself in a fresh temp HOME, twice, and diff. Read every autoMode.allow entry and
confirm it describes a v2 action in plain words. Verdict per Expect id.
