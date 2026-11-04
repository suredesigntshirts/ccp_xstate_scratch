```json
{
  "id": "probe-platform-baseline",
  "title": "Measure what the platform allows in a fresh v2 project",
  "stage": "s0-environment",
  "kind": "probe",
  "status": "ready",
  "outcome": "A dated report states, for the Claude Code version the v2 project runs, which of v2's platform assumptions hold in a real Projects thread and which don't.",
  "why": "Every later stage leans on platform behaviour v1 saw only partly or in another project. The riskiest one, whether the host may spawn workers on a wake no person asked for, decides the host design. A one-hour probe is cheaper than building on a guess.",
  "serves": [
    "L-classifier-judges-the-request",
    "L-graphql-blocked",
    "L-headless-spawn-needs-live-turn",
    "L-hook-time-budget",
    "L-merge-without-review-flag",
    "L-mods-capabilities",
    "L-no-self-modification",
    "L-plugins-load-at-start",
    "L-retries-look-like-bypass",
    "L-rules-before-session",
    "L-spawn-ignores-cwd",
    "L-subagent-depth"
  ],
  "depends_on": [],
  "inputs": [
    {
      "ref": "plan/ledger/platform.md",
      "what": "The assumptions to test and what v1 saw"
    },
    {
      "ref": "v1 Library: notes/mods-probe-2026-10-28/BRIEF-commit-probe.md (copied into this item's prose)",
      "what": "The probe mod v1 used"
    }
  ],
  "outputs": [
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "One row per assumption: holds / doesn't / untested, with evidence and the Claude Code version"
    },
    {
      "ref": "probes/platform/ (throwaway mod and scripts)",
      "what": "The probe code, so it can be rerun on a new Claude Code version"
    },
    {
      "ref": "plan/research/platform-baseline.md, section Allow rules",
      "what": "The full v2 allow-rule set in plain words, for person-setup-sitting"
    },
    {
      "ref": "probes/platform/fixtures/",
      "what": "Recorded wake envelopes, a refusal, a card tap: fixtures later items test against instead of live actions"
    }
  ],
  "expect": [
    {
      "id": "versions",
      "check": "The report names the Claude Code version, the model served and the date",
      "how": "Read the report's header",
      "proof": "world"
    },
    {
      "id": "idle-spawn",
      "check": "The report says whether a mod's $.agent.spawn runs on a send_later wake and on a GitHub PR event wake, each with no person message in that turn, under a pre-placed allow rule",
      "how": "Two probe-log lines per wake kind, each with the wake envelope (its reason shows no person message) and the spawned agent's answer or the refusal text",
      "proof": "world"
    },
    {
      "id": "mcp-from-mod",
      "check": "The report says whether $.mcp.call reaches the project's thread tools (read_thread, request_decision, send_later) from a mod",
      "how": "The probe's logged call results",
      "proof": "world"
    },
    {
      "id": "hooks-see-refusals",
      "check": "The report says how a classifier refusal shows up to hooks and to a mod (event name and fields), or that it doesn't",
      "how": "A deliberately refused harmless action and the probe's capture of it",
      "proof": "world"
    },
    {
      "id": "depth-and-budgets",
      "check": "Subagent depth, the SessionStart and PreToolUse time budgets, and a mod hook's budget are measured",
      "how": "Probe output lines with the numbers",
      "proof": "world"
    },
    {
      "id": "self-edit",
      "check": "The report says whether a thread in the v2 project may commit a change under plugins/ while a released copy of that plugin is loaded, and whether it may when the session loads the working tree",
      "how": "Two probe commits on a scratch branch, with the outcome text of each",
      "proof": "world"
    },
    {
      "id": "idle-merge",
      "check": "The report says whether a merge through the GitHub merge tool on an idle wake is allowed under a pre-placed rule",
      "how": "A probe merge of a scratch PR in a scratch repo, on a send_later wake, with its outcome",
      "proof": "world"
    },
    {
      "id": "page-reads-journal",
      "check": "The report says whether a published artifact can read a JSONL file in the project's Library through the files capability",
      "how": "A throwaway page reading a probe file, with a screenshot or its read result",
      "proof": "world"
    },
    {
      "id": "cwd",
      "check": "The report says whether $.agent.spawn honours cwd on this version, and what works instead",
      "how": "Probe spawn with a cwd and the agent's pwd output",
      "proof": "world"
    },
    {
      "id": "rerunnable",
      "check": "probes/platform/README.md gives one command per probe and says which need a wake that only the platform can make",
      "how": "Read it",
      "proof": "world"
    },
    {
      "id": "negative-evidence",
      "check": "Every \"doesn't hold\" answer has two attempts and the smallest reproduction, each with its raw output, and the verifier reproduced at least one",
      "how": "The verifier reruns one negative probe from probes/platform/README.md",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No harness code",
    "No fixes for anything that fails; failures become ledger rows and change later items",
    "Probe code isn't part of the plugin"
  ],
  "records": [
    "Its own probe log; the journal doesn't exist yet"
  ],
  "person_prereqs": [
    "Create the new Claude Project with only suredesigntshirts/ccp_xstate and a scratch repo, and its own cloud environment",
    "Before the probe thread starts, place the probe's allow rules (listed in the prose) in ccp_xstate main .claude/settings.json and save the setup script so the container rebuilds",
    "Start the probe thread with your words approving the probe mod spawning subagents and merging scratch PRs"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000,
    "replan_to": "person, with the report"
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below. It checks the probe log against the report; it does not need to create wakes.",
  "risks": [
    "The setup script and allow rules have to exist before the probe can run, so the person installs them by hand this once"
  ]
}
```

## Why first

v1's host design depended on a mod spawning workers when a wake arrives. On 28 Oct auto mode refused exactly that
on a scheduled wake, and allowed it only in a turn carrying the person's request. If that still holds under a
standing allow rule, the host can't be a mod reacting to wakes, and stage 3's design changes (fallback: the host is
a thread whose model spawns workers, prompted by the wake). Every other assumption here is cheaper to check in the
same run.

## Allow rules the person places first (plain words, for the probe only)

- "In the ccp_xstate project, the harness probe mod may start subagents with $.agent.spawn on any wake, including
  timer and GitHub event wakes, to test the platform. The project owner approved this on <date>."
- "Running `claude -p --plugin-dir probes/platform` for headless probe runs is allowed."

- "In the ccp_xstate project, the harness probe may merge pull requests in the scratch repo on any wake, to test
  the platform."

## Verifier brief

You check the platform-baseline report. Don't read the builder's reasoning. For each row, find its evidence in the
probe log and fixtures, and confirm they show what the row claims. Rerun the probes that don't need a platform wake
(headless spawn, cwd, page read) with the commands in `probes/platform/README.md`. For the wake rows, confirm from the
recorded wake envelopes that no person message was in the turn. Write a verdict listing each Expect id as MET, NOT MET
or UNCLEAR, with the evidence line.
