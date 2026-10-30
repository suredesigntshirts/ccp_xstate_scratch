# Process: checks, verification, replanning, the person

### L-expect-checkable-before-accept
**Lesson:** Every acceptance line must be checkable before accept. A step after landing in Expect can never be met.
**Evidence:** ccp_machine#102 had "the lead records #66 in the live store after landing" as a criterion, so accept fell to a person tap. #157's "replay clean on a copy" failed on main too, so the item stalled until #161 fixed the root cause.
**Fate:** design. The item schema separates `expect` from `after_landing`. Environment-level lines are run on main before the item is filed.

### L-missing-input-passes
**Lesson:** A check that treats missing input as a pass turns gaps into green.
**Evidence:** `if (!expect) return null` let #94 be accepted with no criteria. 11 of 50 requests had no Expect lines. Doctor warnings never blocked (audit R3).
**Fate:** test. Every v2 guard and check has a test for absent input that fails closed.

### L-expect-format-one-owner
**Lesson:** A format with two writers drifts. The template wrote `## Expect` bullets while the parser read `^Expect:` lines, both by the same session 84 minutes apart.
**Evidence:** Audit F7. Numbered Expect lists were later dropped by a bullet-only regex.
**Fate:** design. Items and verdicts are JSON validated by one schema. No prose is parsed into state.

### L-verifier-independent
**Lesson:** The verifier must be a different actor, on a different model if possible, with a brief fixed before the builder starts, and it must not see the builder's framing.
**Evidence:** Verifier briefs written after the builder's report carried its function names and its "judgement call" framing (27 Oct review). v1 then hashed the verifier brief before any build (VERIFIER_BRIEF_FIXED).
**Fate:** design. The workflow fixes the verifier brief in the briefing step, and its hash goes into context before the build is invoked.

### L-replan-after-second-fail
**Lesson:** After two FAILs on one approach, stop and replan with a written five-whys instead of another round.
**Evidence:** ccp_machine PR #72 ran 5 rounds of a Bash parser before anyone stepped back. The person: "the real bug is nobody stepped back." Replan rule ccp_machine#93.
**Fate:** test. Case C-second-fail-replans. "Same approach" is decided from structured verdict fields (failed line ids), not text.

### L-no-checks-the-builder-writes
**Lesson:** Check files written by the builder are not evidence.
**Evidence:** 37 of 37 builder-written check lines were `[met]`. One check swapped all three lines and still passed (audit F9).
**Fate:** design. Only the verifier's report counts, and it names the commit it checked.

### L-proof-source
**Lesson:** An Expect line proven only by tests the builder writes, on fixtures the builder makes, is self-graded, however well the item is shaped.
**Evidence:** The 30 Oct anti-slop review of this plan: 23 of 74 Expect lines in ready items were proven only that way, 0 items checked their outcome on the real platform before accept, and the only merge gate was a PASS review the builder could post itself (same account everywhere). Cheapest fakes it found: a salvage parser passing "live capture", every idle gap counted as working.
**Fate:** design. Every Expect line names its proof (world, verifier, builder). The checker refuses a ready build item with no world line or with more than half builder lines. The verifier commits its own tests and verdict.json, with a mutation for each builder line, from a session other than the builder's, and CI checks it at the head sha. An item's head and Verifier brief are frozen once its build starts; only a replan PR changes them.

### L-attention-is-the-constraint
**Lesson:** The person's attention is the system's constraint. Never route a mechanical check to them.
**Evidence:** The person: "Is this appropriate use of my scarce attention?" (27 Oct). Audit F2: hand-posted cards with 0 taps.
**Fate:** measure. Count every card, tap, question and wait on the person, per item. Only decisions needing their taste or authority go to them.

### L-stand-in-decides
**Lesson:** While the person is away, a stand-in on a different model decides two-way doors under a grant the person set. Only one-way doors outside the work wait for a tap.
**Evidence:** The person on 28 Oct 03:17: "Stop asking, waiting on my input." About 10 cards had piled up overnight. The 18:55 grant used the Bezos one-way/two-way door rule.
**Fate:** design. A waiting state declares its card (meta.interaction). The stand-in picks one of the legal events, and the machine refuses the rest. Grants are data the person sets.

### L-never-idle-on-person
**Lesson:** While a decision waits, keep doing every step that doesn't need its answer, and schedule a wake so a quiet thread can't stall overnight.
**Evidence:** 28 Oct 01:59: "you could have been working for last 5 hours, but instead did nothing while I was sleeping."
**Fate:** test. Case C-waiting-does-not-stall: with a card open, independent items still advance.

### L-merge-authority
**Lesson:** The person doesn't merge. Threads merge after green CI and an independent PASS.
**Evidence:** The person, 27 Oct 10:48: "You merge. I don't merge."
**Fate:** design. Merge is a host effect in the merging state, never a person task.

### L-issues-state-problems
**Lesson:** An issue states the problem, root cause and outcome-style Expect lines, and proposes no fix. The fix is chosen at a plan step with alternatives.
**Evidence:** 41 of 43 issues prescribed the fix, and plans were written afterwards with no alternatives (audit F8). The person asked: "Is it appropriate for you to decide the solution, or just report the issue?"
**Fate:** design. Workflows that need a plan have a planning state whose output names the options considered.

### L-findings-recent-case
**Lesson:** Report a finding with its most recent case, earlier attempts and status now. Don't report bugs already fixed.
**Evidence:** The person, 27 Oct: "we developed this harness and iterated and resolved issues along the way."
**Fate:** design. The verifier's and reviewer's report formats carry these fields.

### L-scratch-names-carry-item
**Lesson:** Parallel agents share scratch space. Every scratch file name must carry its item id.
**Evidence:** Two builders both wrote `pr.md`, and one overwrote PR #66's body with #68's (28 Oct).
**Fate:** design. The host gives each actor its own folder.

### L-parallel-only-disjoint
**Lesson:** Run items in parallel only when they touch different files and none builds on another's unlanded work.
**Evidence:** The 28 Oct lead rule under the person's "up to 3 if they don't conflict".
**Fate:** design. A workflow-level concurrency rule. Start with 1, as Gall's Law says.

### L-plans-need-independent-read
**Lesson:** A plan written by the driving lead needs an independent read before acting.
**Evidence:** The landing-gate rethink: an independent reviewer found the proposed GitHub-check option weaker than the existing gate (28 Oct 15:25).
**Fate:** design. This plan gets an independent review pass in step 6.
