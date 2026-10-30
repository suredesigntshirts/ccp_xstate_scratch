# Growth: keeping the code and the rules small

### L-rules-in-spec-not-host
**Lesson:** Rules belong in the machine JSON, read by a fixed interpreter. A rule that exists only in host JS can't be seen, bounded or tested against the spec.
**Evidence:** M1c and M1d put PR-binding rules in host JS with no spec trace (27 Oct). Fixes went to host code while the spec stayed unchanged from PR #2 (audit R4). Workflow behaviour lived in SKILL.md prose, changed in 30 of 57 commits.
**Fate:** design. Workflows are data. The engine refuses only what a workflow file refuses, and CI fails on a refusal not traced to the spec.

### L-count-concepts
**Lesson:** Count concepts added, merged and removed per change, not lines. Thoughtful abstractions that shrink the code are welcome.
**Evidence:** The person's code-growth rules, 27 Oct 17:44-17:50. v1 reached 6 machines, 38 states, 141 guards and 79 context fields.
**Fate:** design. Each item states a concept budget. The parity stage compares concept counts with v1.

### L-build-for-next-real-item
**Lesson:** Build only what the next real item needs. Add a state, gate or role back only when a real item needs it.
**Evidence:** Triage tiers, plan, accept and integration gates, history states: v1 built them up front. The XState doc's park list defers them (Gall's Law).
**Fate:** design. The skeleton workflow starts minimal, and the ledger rows say why each thing is or isn't there.

### L-measure-then-park
**Lesson:** Keep usage numbers for every path. Decide what to park or delete later, with the person, never in a naive deletion pass.
**Evidence:** The person, 27 Oct 17:50, and again in the XState plan ("no blanket deletion pass").
**Fate:** measure. The journal records which states and transitions real items used.

### L-theory-written
**Lesson:** Keep the theory written (a SPEC and a how-it-works), with prose pointing at the spec instead of restating its rules.
**Evidence:** Naur's programming as theory building, a project principle. ccp_machine's CLAUDE.md: "Prose points at it … instead of restating its rules."
**Fate:** design. Each plan item carries its why, and the repo keeps one SPEC that points at the workflow files.

### L-cost-asymmetry
**Lesson:** A check that honest agents pay for daily and that catches only drift is suspect. Measure denials against true catches.
**Evidence:** The Bash reader's 73 denials against about 4 real catches (pattern review). Habits that work around a guard are evidence of false positives.
**Fate:** measure. Every guard's denials are counted, and a guard with no true catch over N items is flagged for review.

### L-walking-skeleton-control-first
**Lesson:** A walking skeleton that builds control flow first and leaves roles as prose will keep the prose forever.
**Evidence:** Audit R7: v1's skeleton left workers and reviewer as descriptions "to fill in later". They never were.
**Fate:** design. v2's skeleton includes the actors (a real builder and a separate verifier) from the first run, even if each does little.

### L-xstate-version
**Lesson:** XState 5 is stable. XState 6 brings durable execution, schemas and Stately Agent, but is alpha. v1's spec loaded on both.
**Evidence:** 5.33.3 pinned. 6.0.0-alpha.70 loads the spec (26 Oct). @statelyai/agent 2.0 needs 6.
**Fate:** design. Pin 5.33.3, which PR #110 ran end to end with restore and stale-run refusal. A v6 spike is parked (probe-xstate-runtime) until durable execution is needed.

### L-dynamic-workflows-limits
**Lesson:** Claude Code dynamic workflows have no mid-run input and resume only within one session, so they can't hold a long flow with human gates. They do fit one fan-out stage.
**Evidence:** Library: external-docs/code.claude.com/docs/en/workflows.md, compared in the XState doc's "Second pass".
**Fate:** design. XState holds the long flow. A workflow or SDK `query()` may be the executor for one stage, behind the same output schema.

### L-first-item-is-product
**Lesson:** The first real item must be product work, or the harness measures itself and calls it progress.
**Evidence:** The first plan draft took its first real issue from ccp_xstate itself, which its own overhead rule scores as 100% harness (plan-review finding 2). v1's late days were mostly harness work about the harness.
**Fate:** design. The first real issue and the toy run come from a product repo the person picks.
