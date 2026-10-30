# The v2 plan

This folder is the plan for building the harness again on XState, in this repo. It is a plan only. Nothing
here is built until an item's status says `ready` and a thread picks it up.

The plan is data. Every item is one file with a fixed JSON head, so a script can check the plan, and the
v2 harness can take its first real work items from it.

## Layout

```
plan/
  README.md          this file: how the plan works and how to change it
  item.schema.json   the shape of an item's JSON head
  check.mjs          checks the whole plan (node plan/check.mjs)
  stages/<id>.md     one file per stage: its goal and its exit gate
  items/<id>.md      one file per item: JSON head, then prose
  ledger/            what v1 taught us, one row per lesson (L-... ids)
  cases/             real situations v1 handled, which v2 must pass (C-... ids)
  research/          what we read before deciding, with sources
  decisions/         the person's choices, in their words
```

## How an item is written

An item file starts with a fenced `json` block, which is the item's head and follows `item.schema.json`.
Prose follows the block: the reasoning, the options considered, anything a builder needs that doesn't fit
a field. The head is the contract, and the prose explains it.

A complete head answers nine questions. The checker refuses an item marked `ready` that leaves one open.

| Field | Question it answers | Why v1 taught us to ask |
|---|---|---|
| `outcome`, `why`, `serves` | What is true when it's done, and which lessons does it serve? | The theory gets lost when only the code survives (Naur) |
| `inputs`, `outputs` | What does it read, and what does it hand on? | v1's builder→verifier handoff lived outside the machine |
| `expect` | How does someone else check it before accepting? | Post-landing steps in Expect forced person taps twice |
| `cases` | Which real v1 situations must it pass? | "On par" has to mean passing what v1 actually met |
| `concepts`, `non_goals` | How much does it add, and what won't it do? | 141 guards grew one reasonable check at a time |
| `records` | What does it log, so we can see it working? | v1 salvaged its own history after the fact |
| `person_prereqs` | What must the person do before the thread starts? | A thread can't add its own allow rules |
| `step_back` | When does it stop retrying and replan? | PR #72 ran 5 rounds before anyone stepped back |
| `verifier` | Who checks it, from what brief, written when? | Self-approval is a verification gap, not a judgment call |

## Splicing in new work

The plan will change. These rules keep a change to one file plus edges:

- **Ids are names, not numbers.** An id is a short slug (`obs-live-journal`). Order comes from `stage` and
  `depends_on`, never from an id or a file name, so inserting an item never renumbers anything.
- **To add an item,** write its file and point its `depends_on` at what it needs. If something later now
  needs it, add the new id to that item's `depends_on`.
- **To split an item,** mark it `split` with `replaced_by` naming the new ids. Items that depended on it
  move to the new ids.
- **To drop an item,** mark it `dropped` with a reason in `why`. Never delete the file: the reason is part
  of the theory.
- **To add a stage,** write its file and give it an `order` between two existing ones (use decimals,
  such as 2.5).
- Run `node plan/check.mjs` after any change. It refuses unknown ids, cycles, an item that depends on a
  later stage, and a `ready` item with an empty field. `--order` prints the items in build order, and
  `--coverage` lists ledger rows no item serves.

## How slop is kept out

An item is done when the verifier, not the builder, shows its outcome holds (ledger L-proof-source). Four rules hold
that up, and each is enforced by something other than the builder:

- **Every Expect line names its proof.** `world` means the real platform or GitHub shows it before accept (a real
  session, PR, CI run or published page). `verifier` means tests or reads the verifier writes itself. `builder` means
  the builder's own tests. `check.mjs` refuses a ready build item with no `world` line, or with more than half its
  lines `builder`.
- **The verifier commits its evidence.** It writes its tests under `verify/<item>/` and a `verdict.json` that marks
  every Expect id MET or NOT MET with the command and an output excerpt, and, for each `builder` line, the code it
  broke and the test that went red. CI (repo-skeleton's verdict gate) checks this at the head sha and refuses a
  verdict committed from the builder's session.
- **The contract is frozen.** Once an item's build starts, CI refuses a PR that changes its head or Verifier brief.
  Only a PR labelled `replan` that touches nothing but `plan/` may change them.
- **No stubs count as done.** CI fails on TODO, FIXME, "not implemented" or a skipped test in `packages/` and
  `plugins/`.

What this doesn't close: every agent acts as the person's GitHub account, so a `Claude-Session` trailer is weak
identity, and a determined builder session could forge a verdict commit. The journal records which session wrote
what, and the stage gates put a real result in front of the person. A separate verdict identity stays parked
(ledger L-same-account-everywhere) until a forged verdict is actually seen.

## Status

`draft` (being written) → `ready` (complete head, can be picked up) → `doing` → `done`. Off-path:
`split`, `dropped`, `parked` (kept, not now).

## Principles the plan is held to

Gall's Law (a working small system first), Theory of Constraints (each stage attacks the current
bottleneck), walking skeleton (end to end before wide), root cause over symptom, programming as theory
building (the why travels with the item), Kaikaku.
