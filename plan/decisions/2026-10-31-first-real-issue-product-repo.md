# First real issue: product repo and issue, chosen by the stand-in

**Date:** 2026-10-31
**Decided by:** the "Continue the v2 build past s3" thread, as the person's stand-in. At 02:40Z the person wrote:
"Work autonomously, I'm gone for 4 hours. I authorize you to act on my behalf as a stand in and make decisions."
Nothing below is in the person's own words; each answer is Claude's choice with its reason.

## The repo: `suredesigntshirts/ccp_machine_test`

The candidates were the repos the person's account can push to (`list_repos`, 02:42Z):

- **ccp_machine** (v1's harness). Rejected: work there is harness work about a harness, which is exactly what
  L-first-item-is-product rules out.
- **The Shopify theme and storefront repos** (theme-*, harempants.com, the-islander). The most "product" of all,
  but rejected for a first item: they are private, and Actions minutes on private repos are used up, so the
  product-ci Expect line could never be met; and a merge to a theme's main may deploy to a live store, a one-way
  door a stand-in should not open.
- **ccp_machine_test** (chosen). Its README makes it a monorepo of standalone tools, each a workspace under
  `packages/` that works on its own; it is public, so its `test` workflow runs (green at `b772aff`, 27 Oct); a merge
  deploys nothing; and plan-review finding 2 named "a ccp_machine_test tool" as the kind of first item it meant. Its
  `packages/` is empty today, so the first tool is new product work, not a port.

Its open issues (#18, #36, #37, #98, #99) are all v1 harness backlog, so none qualifies.

## The issue: a `jsonl-lint` tool

"Add `packages/jsonl-lint`: a CLI that reads a JSONL file and reports the line number of every row that is not
valid JSON, exiting 1 if any." It is small (one file and its tests), has a clear done, and serves a need this
project has actually had: v2's journal is JSONL appended over a network mount, and the journal-schema thread left
cross-container appends unproven (a torn or interleaved row would show as an invalid line). The issue is filed in
ccp_machine_test by this thread and run through quick-fix by the engine.

## What still waits on the person

The quick-fix workflow ends in a merge card ("Merge this PR at the verified commit?"), and only a member's tap
moves it (engine-toy-run: `close_decision` wakes nobody). A stand-in can't tap for the person, so the merge Expect
line waits for the person's tap when they return. Everything before the card runs now.

Reversing this choice costs one closed issue and PR in ccp_machine_test.
