# The first stand-in grant

**Date:** 2026-10-31
**Decided by:** the "Continue the v2 build past s3" thread, as the person's stand-in, from the person's own words:
02:40Z "Work autonomously, I'm gone for 4 hours. I authorize you to act on my behalf as a stand in and make
decisions", and 03:03Z "I'm not around, I said work autonomously".

engine-cards-standin needs a first `grants.json` ("Write the first grants.json with the thread"). The person is
away, so the stand-in writes it from those two messages and keeps it as narrow as the work needs:

```json
{
  "grants": [
    {
      "id": "2026-10-31-away-4h",
      "workflow": "quick-fix",
      "ask": "ask",
      "choices": ["approve", "reject"],
      "repos": ["suredesigntshirts/ccp_machine_test", "suredesigntshirts/ccp_xstate_scratch"],
      "until": "2026-10-31T06:40:36Z",
      "granted_by": "Sure Team",
      "said": "Work autonomously, I'm gone for 4 hours. I authorize you to act on my behalf as a stand in and make decisions",
      "said_at": "2026-10-31T02:40:36Z"
    }
  ]
}
```

- **Only quick-fix's merge ask**, the one ask the first real item showed waiting (retro finding 1).
- **Only the test product repo and the scratch repo.** Not ccp_xstate itself (its merges keep their own gate) and
  not any storefront or theme repo, where a merge may deploy.
- **It expires** when the person said they'd be back (4 hours after 02:40:36Z). After that, asks wait for a tap
  again until the person writes a new grant.

The person can widen, narrow or delete it by saying so; the file lives in the harness folder beside the journal.
