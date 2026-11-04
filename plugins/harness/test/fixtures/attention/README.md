# Attention fixtures (plan item obs-person-attention)

- `tap-wake.txt`: a real decision-chosen wake, verbatim. The person tapped option A on card
  `cmsg_01VhYV3jhQ9s4qrrh2th12sN7oo3Bm18DgfoRpQy3bR2XZ` in the wf-quick-fix thread at 16:54:27Z on 2026-10-30. Read
  from that session's events with claude-code-remote `list_events`.
- `message-wake.txt`: the real mention wake that came three seconds later in the same thread, with the person's text
  replaced by a placeholder. Everything else is verbatim.
- `card-input.json`: the PostToolUse input for the request_decision call that posted that card (at 16:29:24Z). The
  question and options are the card's own, from `read_messages_by_id`; the result is the text request_decision
  returns (seen in probes/platform/fixtures/runs/live-thread.jsonl). Claude Code's input around them is shaped like
  `post-message-input.json`.
- `post-message-input.json`: a real PostToolUse input for an MCP tool named `mcp__hearthbot__post_message`, recorded
  from `claude -p` 2.1.314 with a stand-in stdio server answering `{"message_id","thread_id"}` as hearthbot does.
  It shows Claude Code hands an MCP result to the hook as its content blocks.
