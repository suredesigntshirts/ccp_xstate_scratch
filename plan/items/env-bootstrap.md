```json
{
  "id": "env-bootstrap",
  "title": "Install the plugin from the repo, gate it per project, and start every session with a fingerprint and a self-check",
  "stage": "s0-environment",
  "kind": "build",
  "status": "done",
  "outcome": "A stub pasted into the project's environment runs the repo's setup script, which installs the released plugin and v2's allow rules. The plugin does nothing until installed in a project, and every session in an installed project starts by journalling a fingerprint row and a short self-check.",
  "why": "Repo settings and skills don't load in Projects threads, rules must exist before a session starts, a pasted full script goes stale, and v1 lost hours to stale installs and rules that hadn't loaded. These three pieces only make sense together, so they are one PR (plan-review finding 1c).",
  "serves": [
    "L-setup-script-stub",
    "L-subagent-depth",
    "L-repo-skills-dont-load",
    "L-rules-before-session",
    "L-rules-name-the-work",
    "L-container-is-ephemeral",
    "L-plugins-load-at-start",
    "L-version-every-session",
    "L-copies-carry-lineage",
    "L-hook-time-budget",
    "L-no-self-modification"
  ],
  "depends_on": [
    "repo-skeleton",
    "journal-schema",
    "person-setup-sitting"
  ],
  "inputs": [
    {
      "ref": "ccp_machine infra/cloud-environment/ and plugins/harness (install gate, HARNESS_DISABLED)",
      "what": "v1's working setup and gate to adapt"
    },
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "Load path, budgets, and how the installed plugin must be kept apart from the repo working tree"
    },
    {
      "ref": "plan/decisions/person-setup-sitting.md",
      "what": "The allow rules the person placed"
    }
  ],
  "outputs": [
    {
      "ref": "infra/cloud-environment/paste-me.sh and setup.sh",
      "what": "Stub and setup: install the plugin as a released copy (never a link to the working tree), merge settings, set depth 3, log env names only"
    },
    {
      "ref": "plugins/harness (plugin.json, install skill, installed gate, SessionStart hook)",
      "what": "Install with the person writes install.json and the journal root; SessionStart writes session.fingerprint and session.selfcheck"
    }
  ],
  "expect": [
    {
      "id": "clean-home",
      "check": "setup.sh run twice against an empty HOME produces the same ~/.claude files",
      "how": "The verifier runs setup.sh twice in its own empty temp HOME and diffs",
      "proof": "verifier"
    },
    {
      "id": "copy-not-link",
      "check": "The installed plugin is a copy of a release, so editing plugins/ in the repo doesn't change what a running session loads",
      "how": "The verifier edits a file under the repo's plugins/ after setup and diffs the installed copy",
      "proof": "verifier"
    },
    {
      "id": "no-values-logged",
      "check": "The setup log names environment variables but never their values",
      "how": "Test with a secret-looking variable",
      "proof": "builder"
    },
    {
      "id": "inert",
      "check": "With no install marker, every hook exits 0 with no output and writes nothing",
      "how": "Hook tests in an empty temp project",
      "proof": "builder"
    },
    {
      "id": "rows",
      "check": "A session start in an installed temp project writes one fingerprint and one self-check row; a failed check is named in one plain sentence",
      "how": "Hook tests with stubs, one check failing at a time",
      "proof": "builder"
    },
    {
      "id": "real-session",
      "check": "A real Claude Code session, with a fresh HOME set up by this PR's setup.sh, loads the installed copy as a plugin and journals one fingerprint row whose plugin version and commit match the copy's release.json, and a self-check where every check but the release check passes",
      "how": "The verifier runs setup.sh into its own temp HOME, runs the install skill's script, starts claude -p in an empty folder with that HOME, and reads the journal",
      "proof": "world"
    }
  ],
  "after_landing": [
    "The person pastes paste-me.sh and saves the setup script once; the stage gate checks the first real thread's rows",
    "Moved out of Expect by replan (plan/decisions/2026-10-30-env-bootstrap-fresh-project-after-landing.md): in a fresh thread of the v2 project after the setup sitting and the first harness-v* release tag, the first session journals one fingerprint row whose plugin version equals the latest release, and a passing self-check. The s0 gate fresh-install checks it."
  ],
  "cases": [
    "C-older-writer-refused"
  ],
  "concepts": {
    "adds": [
      "setup script",
      "install marker",
      "fingerprint",
      "self-check"
    ],
    "budget": 4
  },
  "non_goals": [
    "No self-update or clean-room job (self-update-by-version and clean-room-install-test follow in this stage)",
    "No network probes beyond GitHub REST"
  ],
  "records": [
    "session.fingerprint",
    "session.selfcheck"
  ],
  "person_prereqs": [
    "None beyond person-setup-sitting"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2500000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "If the probe shows that committing to plugins/ is refused even with a copied install, building moves to a project that doesn't load the v2 plugin; see probe-platform-baseline"
  ]
}
```

## Verifier brief

Run the tests. Run setup.sh yourself twice in a fresh temp HOME and diff. Edit a file under the repo's plugins/ and
confirm the installed copy didn't change. Run each hook with sample input in a temp project without a marker and
confirm silence. Verdict per Expect id.
