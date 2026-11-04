# Anti-slop review of the plan (30 Oct 2026)

An independent reviewer read every live item and asked: could a builder pass every Expect line and the verifier brief
without achieving the item's outcome? Asked by the person: "What do we have to prevent slop from getting built?"

## Findings
- Of 74 Expect lines in ready items, 45 were proven by tests the builder writes; 23 only by those, on the builder's
  own fixtures or stubs. About 14 were "the report says whether" lines that any answer satisfies. 0 items checked
  their outcome on the real platform before accept.
- The only hard merge gate was a "PASS review naming the head sha", which any session on the person's account can post.
- `verifier`, `concepts.budget`, `non_goals`, `records` and `step_back` were unenforced; the brief sat in a file the
  builder could edit.
- Cheapest fakes: obs-live-capture passed by a post-hoc transcript parser (v1's salvage); obs-time-and-rework by
  counting every gap as working; engine-host's no-agent-events by checking a caller-set source string; engine-actors'
  own-folder by two strings in two briefs; engine-effects' no-bash by hiding shell calls outside effects/; obs-page by
  a data layer that calls the views; first-real-issue's asks by having zero cards; engine-host's brief named six
  cases while its head named four.
- Verdict: the plan would likely produce a skeleton that merges a toy and one real issue (those are checked on
  GitHub), but not trustworthy measurement underneath, and every later decision rests on those numbers.

## What changed (commit 3707735)
- `proof` on every Expect line; checker rules: a world line per ready build item, at most half builder lines, a
  Verifier brief on every ready item, and the brief's case ids must be in the head.
- repo-skeleton's CI: verdict.json at the head sha with a mutation per builder line, verdict from a session other
  than the builder's, contract freeze outside replan PRs, stub ban.
- The eight items above rewritten with world lines (live timing, real scratch PRs, the real Library mount, the
  published page, product CI on the first real issue). env-bootstrap's stale non-goal fixed.
- Ledger row L-proof-source. README section "How slop is kept out", including what it doesn't close.

## Not adopted
- Running s0–s3 items through v1's spawn gate, or having the person spawn verifiers: the first keeps v1 in the loop
  that v2 replaces, the second spends the person's attention on mechanics (L-attention-is-the-constraint).
