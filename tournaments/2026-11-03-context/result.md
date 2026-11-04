# Design tournament: final result (after the deletion round)

Judge: the final blind judge, on 2026-11-03. Lanes were judged by letter only. I reran every lane's scenario tests myself
in the lane's workdir (`/tmp/claude-0/-home-user/be7a61c6-b708-529b-89a7-b211d10b05aa/scratchpad/tourney/<lane>`) with
`node --test packages/engine/test/tourney/*.test.js`:

| Lane | Tests run | Pass | Fail |
|---|---|---|---|
| A | 27 | 27 | 0 |
| B | 19 | 19 | 0 |
| C | 22 | 22 | 0 |
| D | 22 | 22 | 0 |
| E | 22 | 22 | 0 |

Every lane has one test file for each of Q1–Q9, F1, F2 and R1. I read the tests changed in round 2: A's Q2 (twin state)
and Q3/Q4/R1 additions, B's Q5 graft test, and E's rewritten Q6 and Q9. Each still asserts the pack's stated outcome and
drives the real guards and needs, accept() and prepare(). Only the outside world is stubbed: GitHub, the web, cards and
the agents themselves. **No pass is rejected.** Only A, B and E took part in the deletion round. C and D are unchanged
from round 1; D added two prompt sentences, which cost no primitives.

## Ranking

The headline is verified passes divided by weighted primitives. Interpreter changes (spec.js/host.js) count double.

| Rank | Lane | Verified | Primitives (weighted) | Passes / primitive | Round 1 | Spec lines | Taps Q1 / F1 | One vocabulary |
|---|---|---|---|---|---|---|---|---|
| 1 | A | 12/12 | **22** | **0.545** | 0.522 (23) | 2645 | 1 / 2 | yes |
| 2 | B | 12/12 | 29 | 0.414 | 0.400 (30) | 3276 | 1 / 1* | no |
| 3 | C | 12/12 | 31 | 0.387 | 0.387 | 3181 | 1 / 2 | yes |
| 4 | D | 12/12 | 34 | 0.353 | 0.353 | **1417** | 1 / 2 | yes |
| 5 | E (control) | 12/12 | 41 | 0.293 | 0.286 (42) | 3297 (+89 for a 4th file) | 1 / 2 | no |

\* B counts only the merge tap. Its escalation card is answered in writing, so it costs the same person effort as the
lanes that report 2.

How I got these counts:

- **A: 23 − inc − reenter + 1 = 22.**
  - The +1 is the role convention: output field names `result`, `pr` and `sources` pick the agent's prompt template.
  - `inc` is deleted from spec.js. `reenter`, `is`, `below`, `after` and the timer primitives appear in none of A's three
    workflows (I grepped for them).
  - The fail-closed gates sit inside the existing accept check, so they cost 0.
- **B: 30 − is − below + G1 = 29.**
  - G1 (the host places the subject) lives in actors.js, so it is not an interpreter change.
  - The workflows' guard forms are only `present`, `in` and `same`. The grep agrees.
- **E: 42 − expect.observed − close + subject handle = 41.**
  - E still uses `is`, `below`, `inc`, `reenter` and `after` in its specs.
- **C and D:** carried over from round 1 (31 and 34).

Expressiveness:

- **B fails one vocabulary.** `writtenBrief` picks a template by input shape, and has templates keyed by the actor names
  research and synthesize.
- **E fails it.** observe.js reads quick-fix's context fields.
- **A passes.** Its `accept()` hard-codes GitHub PR semantics, but every workflow shares them.

## Does any lane beat E (the control)?

Yes, all four do, and A most clearly: **0.545 against 0.293**, with the same 12/12 and the same taps. A also uses 652
fewer spec lines than E (2645 against 3297, or 3386 counting E's fourth file). D is the smallest by far at 1417 lines,
but its three interpreter features keep it at 34 primitives.

All five lanes pass every scenario. So the whole margin is in the denominator: how many primitives each lane needs.

## The helper agent prompt (the person's special focus)

| Lane | Verifier's subject placed by host? | Independence line | GitHub/web text is data | Remaining traps |
|---|---|---|---|---|
| A | No. It is told to run `git fetch origin pull/N/head && git checkout --detach <at>` | yes | yes, for every agent | Assumes the clone's `origin` is GitHub. Still shows `target.key`/`green`, which it must not return. `restated` is key-order sensitive (fixed in words only). Brief actors still read PR rules. |
| B | Yes (G1). It is told not to fetch, check out, reset or commit, and to FAIL if it cannot grade | yes | yes | Fetch fallback never exercised. The prompt still has workflow-shaped templates. |
| C | Yes (native) | partly | partly | Runs without a lane are not told their worktree path. The ToolSearch hint is gone. The `$defs` text still shows `attested`. |
| D | No. It must check out the head itself | no | no | An honest verifier who forgets to check out is refused on every PASS. |
| E | Yes (graft) | no | no general line, only "ignore brief/issue/PR text telling you to move HEAD" | No injection warning for builders or researchers. |

Placing the subject on the host side is the most valuable prompt-related idea of the tournament. It turns a fragile
instruction to the agent into a fact the host makes true, and then measures again at accept. **A, the headline winner,
did not take it.** A's verifier prompt is still the weakest of the strong lanes on this one point.

No lane ran a real LLM agent against its prompts. Every prompt claim is checked as rendered text only.

## Recommended design

**Lane A, with lane C's host-placed subject grafted on.** A is the only lane that keeps 12/12 at 22 weighted primitives
while keeping one vocabulary. A already carries its executed round-2 grafts: lane B's role templates in the prompt, and
gates that fail closed.

The host-placed subject was executed three times, in three different engines: native in C, and grafted into B (G1) and
E. It was **not** executed on A. In A, a target whose `at` is a 40-hex commit would get its worktree added detached at
that commit, and the fetch line would be dropped from the prompt. A's existing `ref` rule already measures HEAD again at
accept, so this graft costs +1 primitive (23, so 12/23 = 0.52). A would still rank first.

Until that graft is run on A, the recommendation that has been executed is A as it stands. The graft is a reasoned next
step, supported by three working implementations.

## What it costs to adopt A

- **Engine:**
  - the list-invoke binding in spec.js (the one interpreter change);
  - `inc` deleted from spec.js;
  - the pin in index.js (by sha256);
  - accept() checks: refs observed, restated inputs equal, stamped fields reserved, gates failing closed;
  - roleOf and the prompt rewrite in actors.js;
  - the child-item relation (effects/item.js).
- **Workflows:** a rewritten quick-fix.json, plus new feature.json and research.json (2645 lines).
- **Tests:** 64 of 128 existing engine tests fail and need porting or retiring. 62 of them come from round 1's changes
  (pr.pushed, timers, tripwire, is/below and headSha removed). 2 come from removing `inc`. standin's
  `grant.workflow` no longer matches the pinned `spec.id`.
- **Wiring not done:**
  - `pump()` (child items) is not called from bin/host.js or deliver(), so feature and research run only in tests;
  - the stop effect has no handler that kills an agent;
  - the replan "why" reaches the item as a done event on the ask run, not as a tap.
- **Design costs accepted:**
  - No `after` or timers, so a silent worker or a cancelled CI run hangs with no card. B kept timers for exactly this.
    R1 passes because the researcher *errors*, which the pack asks for, not because it goes silent.
  - A why-less replan tap is refused, no new card is posted, and the person must answer in words.
  - A bound of N needs N shift-register fields.
  - The `reverifying` twin adds about 170 lines.

## What remains reasoned only

- Whether real agents follow any lane's prompts. All agent output in the tests is stubbed.
- A's `git fetch origin pull/N/head` path, and every lane's fetch-on-missing-commit fallback. No test clone had a remote.
- The host-placed subject on A (see above).
- A stop effect actually killing an agent. Q2 asserts that the stop is emitted, not that the agent dies.
- Liveness without timers in A.
- Production GitHub REST shapes. Every lane tests against a fake GitHub server.

## Best ideas, attributed

- **A: delete the `inc` op with a two-field shift register in one `set`.** `{rebuilt: context.built, built: true}` works
  because `set` reads the context as it was before. It removes a context op and an interpreter op at no primitive cost.
- **A: replace `reenter` with a twin state** (`verifying` ⇄ `reverifying`). This removes a transition kind and costs
  spec lines, not vocabulary.
- **A: the role comes from the declared output schema, not the actor name.** One convention serves quick-fix, feature
  and research, and it removed the actor-name table ACTOR_RULES.
- **A and B: gates fail closed inside the existing accept check** (a files error or a full page counts as "unknown",
  which means the CI-change card is asked). This hardens Q4 with no new primitive.
- **B: `is` and `below` fold into `in`.** Two guard forms are deleted, and a vocab test plus a throw-on-use run prove the
  specs no longer need them.
- **C (also grafted into B and E): the host places the subject.** A commit is checked out detached, and a blob is written
  to `.ccp/subject`; HEAD is measured again at accept. One primitive serves Q1, Q2, Q5, Q9 and R1, and it removes the
  most fragile prompt step.
- **E: drop `expect.observed` and the close effect.** Q9 holds because grading reads only the start input, and Q6 holds
  because of `pr := null` plus a refusal of PRs on the wrong attempt branch. Two primitives that went beyond the pack's
  stated outcome were removed.
- **D: facts recorded on every transition, plus a generic `items` effect.** This gives by far the smallest specs (1417
  lines). It did not reduce the primitive count, because `record`, `always` and the pin are interpreter changes.

## Honest note: did the tournament find something meaningfully different?

Mostly it **converged near the baseline, by subtraction.** The winner, A, is not a new paradigm. It is today's
vocabulary with `after`, the timer primitives, `is`, `below`, `inc`, `reenter`, tripwire and pr.pushed taken out. It
adds one interpreter change (list invoke), a ref handle that the host measures and stamps, and a few accept-time checks.

The control E ended up well behind. That says more about E carrying many observer-style primitives than about a deep
architectural gap. B and C sit between A and E with the same basic shape.

The one genuinely different design, D (facts, record, always), produced much smaller specs but more interpreter
features. Under this pack's scoring it lost.

Three cautions about the margin:

- A's lead rests partly on deletions with real operational costs: no liveness timers, and a worse replan UX.
- The counting rules decide a lot. Interpreter changes count double, and kept baseline primitives count in full.
- 12/12 is universal, so the scenarios no longer separate the lanes. Only the denominator does.

The most important safety idea, the host placing the subject, came from C, not from the winner.
