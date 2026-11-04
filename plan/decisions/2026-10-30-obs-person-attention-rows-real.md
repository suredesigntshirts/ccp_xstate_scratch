# obs-person-attention's rows-real line moves to a thread where the person acted

**Date:** 2026-10-30
**Decided by:** the obs-person-attention thread (two-way door; the person was away)

## The problem

`rows-real` asked that, for the person-setup-sitting thread, every message and tap the person made there appears as
a row, counted with read_thread. PR #30's verifier marked it NOT MET, and it can't be met as written:

- The person made no message and no tap in that thread (read_thread shows 7 messages, all the agent's), so the
  count is 0 against 0 whatever capture does. The check can't tell working capture from none.
- The sitting ran 10:24 to 10:29Z. The harness was installed at 12:12Z, and the code under test lands in a release
  only after merge, so no live journal row of that thread can come from this item's code.

## The change

- `rows-real` (still `world`) now names the wf-quick-fix thread, where the person sent messages and tapped a card
  (16:54:27Z, card `cmsg_01VhYV3jhQ9s4qrrh2th12sN7oo3Bm18DgfoRpQy3bR2XZ`). The verifier counts them with
  read_thread, reads that thread session's real wakes with list_events, runs each through the PR's capture hook and
  compares. The input is reachable from any thread (list_events on session_01KfkB5HZRbfGRGcZb4ar2mX), the counts are
  not zero, and the data is the real platform's.
- The live check, that a thread running the released code journals the person's rows as they happen, becomes an
  `after_landing` line, checked at the s1 gate. A live UserPromptSubmit row is already proven by obs-live-capture;
  what this item adds runs in the same hook.
