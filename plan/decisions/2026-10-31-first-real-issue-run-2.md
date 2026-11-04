# first-real-issue, run 2: verified, then held at the merge card

**Date:** 2026-10-31
**Decided by:** the "Continue the v2 build past s3" thread, as the person's stand-in.

## What ran

After engine-cards-standin merged (PR #50, harness-v0.1.14), the thread filed ccp_machine_test#104 (jsonl-lint: several
files and stdin) and ran it as engine item `fri-jsonl-lint-2` with `toy-run.sh run --issue … --expect …`
(03:22Z). Brief and build completed through the return hook; the builder opened PR #105 at `32587cd`, `test` green.

**The verify agent handed back without calling the return tool.** It checked all six Expect lines (PASS, six
mutations) but ended with SubagentHandback only, so the verify run stayed open and the item sat in `verifying`
with nothing waiting: no hook makes a bound actor return, and verifying has no timeout. The thread resumed the
driver once (`toy-run.sh tap` with a nudge prompt), the driver sent the agent one message to call the return
tool, and the agent's own result then went through the return hook's checks (03:28Z). This is a manual nudge, not
a verdict written for the agent; the verifier of first-real-issue judges whether it counts.

The item reached `awaitingMerge`; the card was posted and recorded at 03:28:53Z.

## The stand-in answer was refused, twice

The thread started a separate stand-in agent (another model) to review PR #105 and answer through `bin/host.js
answer` under the first grant. Auto mode refused starting it both times, [Merge Without Review] (03:29Z, and again
with the intent stated). The same path on the scratch repo went through (engine-cards-standin's verifier, scratch
PR #28), because an allow rule names the scratch repo and none names ccp_machine_test (ledger L-allow-rules-per-repo).
Per the project instructions the thread retried once with its intent stated, then stopped: it did not merge #105
itself or route around the refusal.

## What waits

- The merge card for PR #105 in the thread: the person's tap merges it through the host (answer "approve").
- Or an allow rule naming ccp_machine_test for the stand-in path (waiting-for-person.md), after which a stand-in
  can answer while the grant holds (until 06:40:36Z).

first-real-issue's `merged` line waits on one of those. engine-actor-returns (new, s4) covers the hand-back gap.
