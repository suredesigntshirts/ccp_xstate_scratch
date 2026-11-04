# Refusals are captured from PermissionDenied and from the transcript

**Date:** 2026-10-30, 18:30Z
**Decided by:** the obs-refusal-log thread (two-way doors; the person was away)

## What the probe found

The platform probe showed a classifier refusal reaching a `PermissionDenied` settings hook. This thread checked the
other two kinds in a `claude -p` child (Claude Code 2.1.314) with a test PreToolUse hook that denies one command and a
settings deny rule for another, logging every tool hook:

- A hook's denial and a permission rule's denial fire **no** hook: no PostToolUse, PostToolUseFailure or
  PermissionDenied. In the Claude Code bundle, PermissionDenied runs only when the decision's reason is the auto mode
  classifier.
- The model sees each as an error tool_result: `PreToolUse:Bash hook error: <reason>` and `Permission to use Bash with
  command <command> has been denied.`

## Decisions

1. **Classifier refusals come from PermissionDenied, in line;** hook and permission denials come from the transcript,
   read by the Stop and SubagentStop handlers that already read it for tokens. This is the item's named fallback ("a
   periodic read of the session event log") for the kinds hooks don't see, done at the turn's end rather than on a timer.
   The cost: those rows land at the end of the turn, so a retry that runs later in the same turn isn't linked.
2. **Rows keep the rule and a hash of the text, never the text.** A permission denial's text holds the command, and
   capture's rule is that no row holds what a tool was given. The classifier's rule (`[Self-Modification]`) is the
   only text the hook gets, and is kept whole. A hook's rule is the name its reason starts with (`<rule>: why`); our
   hooks write reasons that way.
3. **The action hash leaves out a top-level `description`.** Live, the same command was retried under a reworded
   description; the description is the model's label, not the action.
4. **Retry and outcome are read forward, not written back.** Rows are append-only, so a refusal row's `outcome` is
   always `denied`, and a later `refusal` or `tool.call` names it by `retryOf`. Each retry links to the latest refusal of
   the same action, so the rows form a chain.
5. **"One of our own hooks" for the `hook-denials` line is `plugins/harness/test/fixtures/refusals/deny-hook/`**, a
   test plugin whose only rule denies Bash commands containing `ccp-refusal-probe`. The harness has no denying hook
   of its own yet; capture handles any hook's denial the same way.
