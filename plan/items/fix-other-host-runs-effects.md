```json
{
  "id": "fix-other-host-runs-effects",
  "title": "Keep a host that doesn't own an item from running its effects",
  "stage": "s5-parity",
  "kind": "build",
  "status": "ready",
  "outcome": "A host restored by a session that doesn't own the item turns its events away and runs none of its open effects, so a card, post, spawn or merge the owner has open happens once even when another session's host wakes before the owner's.",
  "why": "parity-cases found offer() runs the item's open effects before it reads any input, whoever owns the item: another session's host posts the owner's pending card and writes the effect rows into the owner's file, and two hosts restored together post it twice (plan/decisions/2026-11-01-parity-cases-gaps.md). Done when packages/engine/test/parity/C-two-hosts-one-item.test.js passes and its gaps.json entry is gone; the parity-cases verifier's characterisation test verify/parity-cases/C-two-hosts-one-item.gap.test.mjs asserts today's broken behaviour, so this item deletes it in the same PR.",
  "serves": [
    "L-effects-acked-once"
  ],
  "depends_on": [
    "parity-cases"
  ],
  "cases": [
    "C-two-hosts-one-item"
  ],
  "inputs": [
    {
      "ref": "packages/engine/src/host.js",
      "what": "offer() and runEffects(), which run open effects whoever owns the item"
    },
    {
      "ref": "verify/parity-cases/C-two-hosts-one-item.gap.test.mjs",
      "what": "The verifier's characterisation of the gap"
    }
  ],
  "outputs": [
    {
      "ref": "packages/engine/src/host.js",
      "what": "runEffects runs nothing for a host whose session doesn't own the item"
    },
    {
      "ref": "packages/engine/test/parity/C-two-hosts-one-item.test.js",
      "what": "The case's parity test; its gaps.json entry and the verifier's gap test are removed"
    }
  ],
  "expect": [
    {
      "id": "no-effects",
      "check": "A host whose session doesn't own the item, offered any wake or nothing, starts none of the item's open effects (card, post, run, timer, merge) and writes no row in the item's file; its events are turned away as not-owner in its own session file",
      "how": "The verifier's own test from the case text, with counting handlers and the item's file read before and after",
      "proof": "verifier"
    },
    {
      "id": "parity",
      "check": "packages/engine/test/parity/C-two-hosts-one-item.test.js passes, gaps.json no longer lists the case, verify/parity-cases/C-two-hosts-one-item.gap.test.mjs is gone, and the parity listing test passes",
      "how": "node --test packages/engine/test/parity/",
      "proof": "verifier"
    },
    {
      "id": "owner-runs",
      "check": "The owner's host still runs its open effects once, including after a non-owner host has woken first",
      "how": "Builder's test",
      "proof": "builder"
    },
    {
      "id": "mount",
      "check": "On the project mount (/mnt/project-files), an item started by one real session id with its card pending: bin/host.js wake from another session's hook input posts nothing and adds no row to the item's file, and the owner's next call finishes the card effect once",
      "how": "Two bin/host.js calls with real session ids against a journal under /mnt/project-files, rows read after each",
      "proof": "world"
    },
    {
      "id": "ci",
      "check": "The PR's ci check is green at the head sha",
      "how": "The ci check run on GitHub",
      "proof": "world"
    }
  ],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No forwarding of a non-owner's event to the owner; it stays turned away and journalled",
    "No guard against two processes of the owner's own session running at once"
  ],
  "records": [
    "engine.transition not-owner rows in the non-owner's session file"
  ],
  "step_back": {
    "max_rounds": 2,
    "max_tokens": 1500000
  },
  "verifier": "A separate subagent, using the Verifier brief below.",
  "risks": [
    "An effect left open by an owner session that has ended stays open until a host of that session runs again; who adopts an item whose owner is gone is not this item's question."
  ]
}
```

## Verifier brief

Read C-two-hosts-one-item in plan/cases/work-item.md and write your own test from it, without reading the builder's:
an item owned by one session with an effect open (a card not yet up), then another session's host restored and
offered a wake and an empty offer, with handlers that count every start; confirm none runs and the item's file is
unchanged, and that the owner's host then runs the open effect once. Run packages/engine/test/parity/ and confirm the
case's test passes, its gaps.json entry and verify/parity-cases/C-two-hosts-one-item.gap.test.mjs are gone. Break the
owner check in host.js and show the builder's owner-runs test or yours going red. Do the mount check with bin/host.js
under /mnt/project-files with two real session ids. Read the ci check at the head sha. Verdict per Expect id.
