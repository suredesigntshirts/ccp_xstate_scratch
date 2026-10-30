```json
{
  "id": "retro-first-item",
  "title": "Learn from the first real item and splice the lessons into the plan",
  "stage": "s4-first-real-item",
  "kind": "research",
  "status": "ready",
  "outcome": "A short retro, from the journal, says what ran, what it cost, where it waited and what was refused. Every lesson is a ledger row, and the retro orders the s4b-widen items, dropping any that no finding justifies.",
  "why": "The ratchet: each observed failure becomes a rule, test or check. This is where the plan learns from v2 rather than v1.",
  "serves": [
    "L-findings-recent-case",
    "L-cost-asymmetry",
    "L-measure-then-park"
  ],
  "depends_on": [
    "first-real-issue"
  ],
  "inputs": [
    {
      "ref": "The item's journal and page",
      "what": "The evidence"
    }
  ],
  "outputs": [
    {
      "ref": "plan/research/retro-first-item.md",
      "what": "The retro"
    },
    {
      "ref": "New rows in plan/ledger/, new items in plan/items/",
      "what": "Spliced by the README rules"
    }
  ],
  "expect": [
    {
      "id": "numbers",
      "check": "The retro gives tokens, time by kind, rounds, refusals and person asks for the item",
      "how": "Numbers match the derived views",
      "proof": "verifier"
    },
    {
      "id": "spliced",
      "check": "Every lesson in the retro has a ledger row, and the plan check passes",
      "how": "node plan/check.mjs",
      "proof": "verifier"
    },
    {
      "id": "widen-ordered",
      "check": "Every s4b-widen item's why cites a retro finding, or the item is parked with a reason",
      "how": "Read the items; node plan/check.mjs",
      "proof": "verifier"
    }
  ],
  "cases": [],
  "concepts": {
    "adds": [],
    "budget": 0
  },
  "non_goals": [
    "No fixes"
  ],
  "records": [
    "None beyond the files"
  ],
  "person_prereqs": [],
  "step_back": {
    "max_rounds": 1
  },
  "verifier": "A separate subagent recomputes the numbers from the journal.",
  "risks": []
}
```

## Verifier brief

Before reading the retro, recompute tokens, time by kind, rounds, refusals and person asks for the item from the
journal yourself, and compare with the retro's numbers and the derived views. Any number off by more than 5% is NOT
MET. Then check every lesson has a ledger row, every s4b-widen item's why cites a retro finding (or it is parked with
a reason), and run `node plan/check.mjs`. Write verify/retro-first-item/verdict.json in your own commit.
