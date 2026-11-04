```json
{
  "id": "fix-finish-closes-waits",
  "title": "Close an item's open card when it leaves the waiting state",
  "stage": "s5-parity",
  "kind": "build",
  "status": "draft",
  "outcome": "When an item with an open card leaves the state that asked (a push, a red check, the item finishing or its PR merged by another path), the card is closed for the person and nothing about it stays waiting.",
  "why": "parity-cases found the host turns the left ask into a stop effect that no handler carries out, so the person's card stays up after the item has moved on, and quick-fix takes no event for its PR merged by another path (plan/decisions/2026-11-01-parity-cases-gaps.md). Done when packages/engine/test/parity/C-finish-closes-waits.test.js passes and its gaps.json entry is gone; the parity-cases verifier's characterisation test verify/parity-cases/C-finish-closes-waits.gap.test.mjs asserts today's broken behaviour, so this item deletes it in the same PR.",
  "serves": [
    "L-item-finish-clears-inbox"
  ],
  "depends_on": [
    "parity-cases"
  ],
  "cases": [
    "C-finish-closes-waits"
  ]
}
```
