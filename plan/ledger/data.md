# Data: the store's format and history

### L-version-event-schema
**Lesson:** An event log without a schema version breaks every time the format or the rules change.
**Evidence:** The first store's events predate the actor envelope and were refused on replay. The second diverged when rules tightened. Only state.json had a version (28 Oct analysis). Joining the stores into one history took ccp_machine#59 and about 15 PRs.
**Fate:** design. Every journal row carries a schema version from day one. Old rows are upcast on read and never rewritten.

### L-replay-facts-not-rules
**Lesson:** Replay should apply logged events as facts, and judge only new events by today's rules.
**Evidence:** Replay applied today's guards to old events and refused them (ccp_machine#55). Fixed by the decider split (#96/#98) and history eras (#141).
**Fate:** design. The journal holds only external inputs (events, completions with output, timers), which replay as facts. Rule changes come with a recorded spec version.

### L-record-route-at-write
**Lesson:** If replay needs to know which path was taken, record it at write time. Don't search for it afterwards.
**Evidence:** PR #90's route search tried every route until effects matched, and the review said "replace" (pattern review, finding 3). Same for verify-actors time windows (finding 2): three PRs on one check.
**Fate:** design. Each row records its transition id and the call or completion id that caused it.

### L-one-history
**Lesson:** The person wants all work in one history, observable start to finish, that survives schema changes.
**Evidence:** The person, 28 Oct 05:55, overruled "joining old stores isn't worth it". v1 achieved it on 29 Oct (2,119 rows).
**Fate:** design. v2 has one journal per project. Importing v1's history is an option for the parity stage, not a dependency.

### L-placeholders-labelled
**Lesson:** Where old data is missing, labelled placeholders that health checks count are better than silently missing rows or reconstructed fakes.
**Evidence:** The legacy actor and source pre-envelope rows, and doctor's placeholder count. Reconstructing rows from transcripts to quiet a check was rejected (pattern review, finding 4).
**Fate:** design.

### L-older-writer-refused
**Lesson:** A store must refuse writes from an older release, naming both versions.
**Evidence:** `writerNotOlder` (ccp_machine#139, #144) after a lead ran a stale checkout.
**Fate:** test. Case C-older-writer-refused.

### L-effects-acked-once
**Lesson:** Each effect needs exactly one outcome, keyed by id, so a crash or duplicate wake doesn't repeat a merge or post.
**Evidence:** v1's outbox: 359 effects with exactly one ack each, no lost writes (audit "what held"). 104 era effects were left pending until acked by hand (29 Oct).
**Fate:** design. Host effects are idempotent by effect id. Pending effects are visible on the page.

### L-item-finish-clears-inbox
**Lesson:** When an item finishes by any path, everything waiting on it (decisions, inbox entries) must close too.
**Evidence:** ccp_machine#157: items finished out of band left decisions in the person's inbox.
**Fate:** test. Case C-finish-closes-waits.
