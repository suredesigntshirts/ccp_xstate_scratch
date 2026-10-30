# Cases for a work item's flow

### C-verdict-on-old-head
**From:** L-merge-at-verified-head; ccp_machine PR #16 (merged 7 seconds after a FAIL).
**Given** a PASS verdict for commit A, **when** the PR's head is commit B, **then** the item can't reach merging, and the verdict is recorded as stale.

### C-push-after-pass
**From:** L-merge-at-verified-head; the XState doc's "two paths go back".
**Given** an item waiting to merge after a PASS on head A, **when** GitHub reports a push making the head B, **then** the item returns to verifying for B.

### C-pass-carries-to-merge-of-main
**From:** ccp_machine#137 (PR #147).
**Given** a PASS on head A, **when** the new head B is only a merge of main into A with no other change, **then** the workflow may carry the PASS to B, if the workflow file says so. The default is to re-verify.

### C-second-fail-replans
**From:** L-replan-after-second-fail; ccp_machine PR #72.
**Given** a FAIL, a rebuild and a second FAIL on the same Expect line, **then** the item goes to replanning, which waits for a written five-whys, and doesn't start a third build.

### C-stale-completion-dropped
**From:** L-agents-self-report; XState durable-execution incarnation rule.
**Given** a builder run that was replaced by a newer run, **when** the old run's completion arrives, **then** it is journalled as stale and changes nothing.

### C-claimed-pr-not-on-github
**From:** L-facts-from-source; the XState doc's remaining trust question.
**Given** a builder that returns a PR number and head, **when** GitHub shows no such PR or a different head, **then** the completion is refused with the missing fact named, and the item stays in building.

### C-missing-expect-fails-closed
**From:** L-missing-input-passes; ccp_machine#94.
**Given** an item with no Expect lines, **then** it can't leave queued, and the refusal names the missing input.

### C-merge-outside-host-detected
**From:** L-text-is-not-intent; pattern review finding 1.
**Given** a PR merged on GitHub by any path other than the host's merge effect, **then** the health check lists it as unverified, whether or not the PR is bound to an item.

### C-finish-closes-waits
**From:** L-item-finish-clears-inbox; ccp_machine#157.
**Given** an item with an open decision, **when** the item finishes or is cancelled by another path, **then** the decision closes, and nothing about it remains waiting for the person.

### C-waiting-does-not-stall
**From:** L-never-idle-on-person.
**Given** one item waiting on a person's card, **then** another independent item still advances, and a wake is scheduled for the waiting one.

### C-refused-action-not-retried
**From:** L-retries-look-like-bypass.
**Given** a host effect refused by auto mode or a hook, **then** it is journalled with the rule and not retried automatically. The item steps back with the refusal as input.

### C-older-writer-refused
**From:** L-older-writer-refused; ccp_machine#139.
**Given** a journal last written by release N, **when** a session on release N-1 tries to write, **then** it is refused, naming both versions.

### C-duplicate-wake-no-double-effect
**From:** L-effects-acked-once.
**Given** the same GitHub event delivered twice, or a host restart mid-effect, **then** the merge, post or spawn happens once.

### C-stand-in-picks-legal-event
**From:** L-stand-in-decides.
**Given** a waiting state with a card under a grant, **when** the stand-in answers with an event that isn't legal in that state, **then** it is refused. A legal answer is journalled with the grant that covered it.

### C-two-hosts-one-item
**From:** plan-review finding 4; L-library-mount-slow (writes seen about 40 seconds late).
**Given** an item owned by one thread, **when** another session's host receives an event for it, **then** it doesn't apply it; the event is journalled as forwarded or refused, and no effect runs twice.

### C-builder-cannot-change-own-workflow
**From:** L-builder-supplies-gate-inputs; audit R2 (the gated party changed its own rules).
**Given** an item in progress, **when** its builder changes the item's workflow selection or the workflow file it runs, **then** the item keeps running the workflow and hash recorded when it was filed.

### C-red-ci-back-to-building
**From:** audit "what held": CI failures sent items back three times before merge.
**Given** an item whose PR's CI goes red, **then** it can't reach merging, and it returns to building with the failing check as input.
