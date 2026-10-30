```json
{
  "id": "decide-v1-retirement",
  "title": "The person decides what of v1 is parked or retired",
  "stage": "s6-retire-v1",
  "kind": "decision",
  "status": "draft",
  "outcome": "From the comparison, the person decides when ccp_machine stops running v1 and what of it is parked (tagged branch) or kept.",
  "why": "Never a naive deletion pass: decide from usage numbers, with the person.",
  "serves": [
    "L-measure-then-park"
  ],
  "depends_on": [
    "parity-compare"
  ],
  "inputs": [
    {
      "ref": "plan/research/parity-compare.md",
      "what": "The numbers"
    }
  ],
  "outputs": [
    {
      "ref": "plan/decisions/decide-v1-retirement.md",
      "what": "The decision in the person's words"
    }
  ],
  "expect": [
    {
      "id": "recorded",
      "check": "The decision is recorded with its date",
      "how": "Read it",
      "proof": "verifier"
    }
  ],
  "verifier": "None needed; the record is the person's own words."
}
```
