```json
{
  "id": "engine-cards-standin",
  "title": "Let a stand-in answer a workflow's ask through the host, under the person's grant",
  "stage": "s4-first-real-item",
  "kind": "build",
  "status": "done",
  "outcome": "When the person is away, a stand-in session on another model answers an item's open ask through the host: the host takes the answer only if it is one of the ask's legal choices and a grant entry the person set covers this workflow, ask, repo and time, journals the transition with that grant, and runs what follows (the merge) itself. A real run can be started from an existing issue.",
  "why": "Retro finding 1 (plan/research/retro-first-item.md): on the first real item the person was away, the workflow's one ask had no answer the host would take, and the merge happened outside the host, so first-real-issue can't finish without this. v1 had three machines for decisions, grants and audits (34 context fields), cards piled up overnight, and finished items left decisions in the person's inbox. One pattern, a state that declares its card, covers all of it.",
  "serves": [
    "L-stand-in-decides",
    "L-attention-is-the-constraint",
    "L-builder-supplies-gate-inputs",
    "L-standin-gap",
    "L-real-run-reuses-toy",
    "L-allow-rules-per-repo"
  ],
  "depends_on": [
    "engine-effects",
    "engine-actors",
    "obs-person-attention",
    "retro-first-item"
  ],
  "inputs": [
    {
      "ref": "plan/research/retro-first-item.md, finding 1 and 4",
      "what": "Why, and the runner gap"
    },
    {
      "ref": "The person's 31 Oct grant: 02:40Z \"I authorize you to act on my behalf as a stand in and make decisions\", 03:03Z \"I'm not around, I said work autonomously\"",
      "what": "The first grant, restated as data"
    }
  ],
  "outputs": [
    {
      "ref": "packages/engine/src/standin.js",
      "what": "Check a stand-in answer against the ask and the grants; build the completion with source standin and the grant id"
    },
    {
      "ref": "bin/host.js answer",
      "what": "The command a stand-in session runs"
    },
    {
      "ref": "grants.json in the harness folder, and its format in packages/engine/README.md",
      "what": "What the stand-in may decide"
    },
    {
      "ref": "scripts/toy-run.sh run --issue <url> --expect <file>, and toy-run.sh answer",
      "what": "A run from an existing issue, and the stand-in's answer"
    }
  ],
  "expect": [
    {
      "id": "legal-only",
      "check": "An answer that is not one of the open ask's choices, or that no grant entry covers (workflow, ask, repo, expiry), is refused, changes nothing in the item, and the refusal is printed with its reason",
      "how": "The verifier's own tests from case C-stand-in-picks-legal-event, against bin/host.js answer on a recorded item",
      "proof": "verifier"
    },
    {
      "id": "grant-source",
      "check": "Each accepted stand-in answer's engine.transition row has source system standin, ref naming the grant id, and the answering session in its output",
      "how": "The verifier's tests read the journal rows",
      "proof": "verifier"
    },
    {
      "id": "host-merges",
      "check": "On a scratch item run from an existing issue with toy-run.sh run --issue, a stand-in answer through toy-run.sh answer moves the item from awaitingMerge to done, and the host's merge effect merges the PR at the verified sha",
      "how": "A fresh run on ccp_xstate_scratch; GitHub's merge sha and the journal's pr.merge and engine.transition rows",
      "proof": "world"
    },
    {
      "id": "no-tap-needed-for-person",
      "check": "A person's tap on the same card still answers the ask as before, and an ask already answered refuses the other",
      "how": "Builder test on the tap fixture plus a stand-in answer",
      "proof": "builder"
    }
  ],
  "cases": [
    "C-stand-in-picks-legal-event"
  ],
  "concepts": {
    "adds": [
      "grant"
    ],
    "merges": [
      "v1's decision and grant machines, for the merge ask only"
    ],
    "budget": 1
  },
  "non_goals": [
    "No closing cards when an item finishes, and no concurrency for the no-stall case (cases C-finish-closes-waits and C-waiting-does-not-stall stay with a later item)",
    "No learning the person's taste",
    "No stand-in for asks other than the ones a grant names"
  ],
  "records": [
    "engine.transition with source standin and the grant id"
  ],
  "person_prereqs": [
    "None while the 31 Oct grant holds: the stand-in writes the first grants.json from the person's own words, with an expiry, and records it in plan/decisions/"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 2500000
  },
  "verifier": "A separate subagent on a different model from the builder, using the Verifier brief below.",
  "risks": [
    "A stand-in with a shell can run bin/host.js answer by hand, as any agent can append rows (ledger L-same-account-everywhere); the grant check limits what it can answer, not who runs it"
  ]
}
```
## Verifier brief

Write your own tests for case C-stand-in-picks-legal-event from its text, against `bin/host.js answer` on items you
record yourself: an illegal choice, a missing or expired grant, a grant for another repo or ask, and a legal answer.
Check the accepted answer's journal row names the grant and the session. Then do one fresh scratch run from an
existing issue with `toy-run.sh run --issue`, answer its ask with `toy-run.sh answer`, and read the merge sha on
GitHub against the verdict's sha. Verdict per Expect id.
