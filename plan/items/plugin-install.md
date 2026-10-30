```json
{
  "id": "plugin-install",
  "title": "Ship a plugin that installs itself into a fresh project with the person, once",
  "stage": "s0-environment",
  "kind": "build",
  "status": "merged",
  "outcome": "The v2 plugin loads in every session, does nothing until installed, and an install step with the person picks the project's harness folder, writes an install marker and creates the journal root.",
  "why": "The product goal is a harness that installs on a fresh Claude Project from the plugin alone: no memory, Library or artifacts carried over. Plugins load account-wide, so the plugin must gate itself on a per-project marker.",
  "serves": [
    "L-repo-skills-dont-load",
    "L-plugins-load-at-start",
    "L-copies-carry-lineage"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "ccp_machine plugins/harness (plugin.json, install gate, HARNESS_DISABLED)",
      "what": "v1's install gate to adapt"
    },
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "Which load path works in Projects threads"
    }
  ],
  "outputs": [
    {
      "ref": "plugins/harness/.claude-plugin/plugin.json",
      "what": "Name, version"
    },
    {
      "ref": "plugins/harness/skills/install/",
      "what": "The install step: asks the person for the harness folder (default <Library>/harness/), writes install.json {project, folder, release, at}, creates the journal root"
    },
    {
      "ref": "plugins/harness/lib/installed.js",
      "what": "One function every hook calls first: installed here? (marker found, HARNESS_DISABLED unset)"
    }
  ],
  "expect": [
    {
      "id": "inert-until-installed",
      "check": "In a project with no marker, every hook exits 0 with no output and writes nothing",
      "how": "Hook tests in an empty temp project",
      "proof": "builder"
    },
    {
      "id": "install-once",
      "check": "Install writes the marker and journal root; a second install reports it is already installed and changes nothing",
      "how": "Test runs install twice",
      "proof": "builder"
    },
    {
      "id": "disable",
      "check": "HARNESS_DISABLED=1 makes an installed project inert",
      "how": "Hook test",
      "proof": "builder"
    },
    {
      "id": "validate",
      "check": "claude plugin validate passes",
      "how": "CI step",
      "proof": "world"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [
      "install marker"
    ],
    "budget": 1
  },
  "non_goals": [
    "No hooks that do work yet beyond the gate",
    "No pages"
  ],
  "records": [
    "session.fingerprint gains install state, via session-fingerprint-selfcheck"
  ],
  "person_prereqs": [
    "Run the install step once in the v2 project when this lands (a short conversation)"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [],
  "merged_into": "env-bootstrap"
}
```

## Verifier brief

Run the tests and `claude plugin validate plugins/harness`. In a temp project folder with no marker, run each hook
script with a sample input and confirm no output and no files written. Run install twice. Verdict per Expect id.
