# Trust: where facts come from

### L-no-trust-boundary
**Lesson:** If no step needs an input the working thread can't produce itself, every gate is self-graded.
**Evidence:** In the 26 Oct run one session filed, tiered, planned, built, approved as the stand-in and merged 49 of 56 PRs. 76 of 76 decisions were "approve", with 0 rejects and 0 person decisions (Library: research/harness-root-cause-audit/README.md, root R1-R7).
**Fate:** design. Every gate in v2 names at least one input from outside the worker: a GitHub fact, a person's tap, or a completion from a separate actor. The audit's test applies to every item: "does it add an input the builder thread cannot produce?"

### L-agents-self-report
**Lesson:** Events typed by the agent they describe are claims, not facts, and checking who sent them grows without end.
**Evidence:** 299 of 355 early events were typed by hand by the thread they describe. Later, 102 of v1's 141 guards check the sender (unattested, fromOutside, role checks, 13 `…Overreaches`, briefDiffers, tapUnbound).
**Fate:** design. The machine starts work as invoked actors and hears results as completion events. No agent sends lifecycle events, so nothing needs to be attested.

### L-facts-from-source
**Lesson:** A fact should enter from the system where it happened (GitHub, the platform's tap, a completion), never retyped by an agent.
**Evidence:** 30 of 50 merges were logged after GitHub's `merged_at`, and 2 CI events were hand-made to look like `from-github` (audit F17, R5).
**Fate:** design. The host turns webhook payloads, cards and completions into events. A worker's claimed PR is confirmed against GitHub before it enters context.

### L-subagents-distinguishable-by-hooks
**Lesson:** A subagent can be told from its parent only by hook input (`agent_id`, `agent_type`), not by environment.
**Evidence:** Measured 27 Oct: 192 identical env names, but hook input carries `agent_id` on a subagent's calls and not the parent's. A mod's `tool.call` also carries `agentId`.
**Fate:** design. Attribution uses `agent_id` from hooks or mods, never env vars.

### L-same-account-everywhere
**Lesson:** Every agent acts as the person's GitHub account, so GitHub authorship proves nothing about which agent did it.
**Evidence:** All 56 PRs on 26 Oct merged as the person. Only `Claude-Session` commit trailers told sessions apart (audit R1).
**Fate:** design. Who-did-what comes from the journal (run handles), not GitHub authors. A separate verdict identity (a GitHub App) stays parked until a real need appears.

### L-merge-at-verified-head
**Lesson:** A merge is safe only at the exact commit the verifier passed, and a later push must send the item back to verification.
**Evidence:** PR #16 merged 7 seconds after a verifier FAIL, and #32 merged 6 seconds after a verdict that missed an outcome (Library: notes/harness-reflection, lead-merge-on-fail). The store-backed `carries()` check (review id, sha, state) later held up well (pattern review, finding 9).
**Fate:** test. Cases C-verdict-on-old-head and C-push-after-pass. The guard compares `verdict.sha` with `pr.headSha`, both held in context.

### L-text-is-not-intent
**Lesson:** Reading command text to guess what an agent means to do costs honest agents daily and catches almost nothing.
**Evidence:** The Bash text reader made 73 of 86 merge-gate denials on 28 Oct, against about 4 real catches. It needed 7 FAIL rounds across ccp_machine#46 and #72, plus standing habits like "say land, not merge" (Library: notes/harness-reflection/pattern-review.md, finding 1). The person chose to remove it.
**Fate:** design. Enforce at the structured tool (the MCP merge tool's PR and expected head), and detect anything else from GitHub afterwards. Never parse Bash.

### L-authenticate-facts-ok
**Lesson:** Joining structured facts we own (a review id, a sha, a key we issued) is sound, and isn't the text anti-pattern.
**Evidence:** `carries()`, `hookSawCall` and `roleLine` held up in the pattern review (findings 9, 11, 12).
**Fate:** design. Where v2 needs a check, it joins ids it recorded at write time.

### L-builder-supplies-gate-inputs
**Lesson:** A gate whose inputs the gated party types (tier, confidence, autonomy) is no gate.
**Evidence:** `standInMayDecide` read tier, autonomy, confidence and threshold, all typed by the caller. Confidences sat at 0.90-0.92 against a 0.90 bar, and tier 0 (skips gates) grew from 1 of the first 25 items to 11 of the last 25 (audit R2, F3, F4).
**Fate:** design. Workflow selection and risk class are set by whoever files the work, or by a separate triage actor, never by the builder. The value is recorded with its source.
