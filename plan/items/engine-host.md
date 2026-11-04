```json
{
  "id": "engine-host",
  "title": "Run a workflow file: restore, take one event from its source, run effects once, persist",
  "stage": "s3-engine-skeleton",
  "kind": "build",
  "status": "done",
  "outcome": "The host turns each wake (GitHub event, card tap, timer, worker completion) into one event for one item, applies it to that item's workflow, runs the resulting effects exactly once by effect id, and journals the transition with its source and transition id.",
  "why": "v1 asked agents to report what happened, then checked who sent it. The host makes the machine start the work and hear results from their sources, so there is nothing to attest. PR #110 already ran this shape headlessly.",
  "serves": [
    "L-agents-self-report",
    "L-facts-from-source",
    "L-effects-acked-once",
    "L-record-route-at-write",
    "L-replay-facts-not-rules",
    "L-library-mount-slow",
    "L-retries-look-like-bypass",
    "L-no-trust-boundary"
  ],
  "depends_on": [
    "wf-quick-fix",
    "obs-live-capture",
    "obs-page",
    "obs-journal-vs-world",
    "obs-refusal-log"
  ],
  "inputs": [
    {
      "ref": "ccp_machine PR #110 packages/orchestrator/src/{host,driver,step,journal}.js and plugins/orchestrator",
      "what": "The walking-skeleton host to port; it depends only on xstate"
    },
    {
      "ref": "plan/research/platform-baseline.md",
      "what": "Whether the host can be a mod reacting to idle wakes, or must be a thread prompted by the wake"
    }
  ],
  "outputs": [
    {
      "ref": "packages/engine/src/host.js",
      "what": "restore, applyEvent, runEffects, persist; one item per call"
    },
    {
      "ref": "engine.transition, engine.effect rows",
      "what": "With item, state, transition id, event source and effect id"
    }
  ],
  "expect": [
    {
      "id": "duplicate",
      "check": "The same GitHub event delivered twice, and a restart mid-effect, each produce the effect once",
      "how": "The verifier writes its own test from case C-duplicate-wake-no-double-effect",
      "proof": "verifier"
    },
    {
      "id": "stale",
      "check": "A completion from a replaced run is journalled as stale and changes nothing",
      "how": "The verifier writes its own test from case C-stale-completion-dropped",
      "proof": "verifier"
    },
    {
      "id": "refused-effect",
      "check": "A refused effect is journalled with its rule and not retried; the item steps back",
      "how": "The verifier writes its own test from case C-refused-action-not-retried",
      "proof": "verifier"
    },
    {
      "id": "replay",
      "check": "Replaying an item's journal rebuilds its snapshot exactly",
      "how": "Test compares snapshot hashes",
      "proof": "builder"
    },
    {
      "id": "no-agent-events",
      "check": "An event's source comes from the wake envelope the platform delivered; no tool, argument or file an agent can write sets it",
      "how": "The verifier calls every tool the plugin registers with source fields set to wake, completion and timer, and confirms no transition",
      "proof": "verifier"
    },
    {
      "id": "one-owner",
      "check": "An item has one owner thread and one journal file; a second host trying to apply an event to it is refused and journalled",
      "how": "Two real sessions on the Library mount; the second's attempt to apply an event is refused and journalled (case C-two-hosts-one-item)",
      "proof": "world"
    }
  ],
  "cases": [
    "C-duplicate-wake-no-double-effect",
    "C-stale-completion-dropped",
    "C-refused-action-not-retried",
    "C-two-hosts-one-item"
  ],
  "concepts": {
    "adds": [
      "host",
      "effect id"
    ],
    "budget": 2
  },
  "non_goals": [
    "No spawning yet (engine-actors)",
    "No cards yet (engine-cards)",
    "One item at a time"
  ],
  "records": [
    "engine.transition",
    "engine.effect"
  ],
  "person_prereqs": [
    "Allow rules for the host's actions, in plain words, placed and rebuilt before the thread starts (exact wording comes from the probe)"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 3000000
  },
  "verifier": "A separate subagent on a different model, using the Verifier brief below.",
  "risks": [
    "Where the host lives (a mod reacting to wakes, or a thread prompted by the wake) comes from the platform probe; the head holds either way"
  ]
}
```
## How wakes reach the host

The item's owner thread subscribes to its PR's activity when the builder opens the PR, and sets its own timers with
send_later. Card taps arrive in the thread that posted the card, which is the owner. So every wake for an item arrives
in one thread, and that thread's session is the only writer of the item's journal file. Restore reads that one file
by its known path, never a folder (ledger L-library-mount-slow).

## Verifier brief

Read the four cases named in the head first. Write your own test for each from the case text, against the
host's public functions, and run them. Call every tool the plugin registers with forged source fields and confirm
nothing transitions. Run the two-session owner test on the real Library mount. Replay a recorded item journal and
compare hashes. Write verify/engine-host/verdict.json in your own commit, with a mutation for the builder line.
