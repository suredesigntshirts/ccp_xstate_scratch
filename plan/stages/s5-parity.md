```json
{
  "id": "s5-parity",
  "title": "Pass the cases v1 met",
  "order": 5,
  "status": "draft",
  "goal": "v2 passes every case in plan/cases/, and is measured against v1 on the same numbers.",
  "gate": [
    { "id": "cases-pass", "check": "Every live case has a passing test", "how": "npm test" },
    { "id": "measured", "check": "Concepts, refusals, person taps, time and tokens per item are reported for v1 and v2", "how": "The comparison page" }
  ]
}
```
