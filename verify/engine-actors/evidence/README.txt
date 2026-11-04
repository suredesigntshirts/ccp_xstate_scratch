World evidence for engine-actors, from real headless `claude -p --plugin-dir plugins/harness` runs at
2fbce741ca00cdfa18b5ddbaee40e78e88ea457d on item va2 (quick-fix) against ccp_xstate_scratch PR #20
(head b7a9153721bfa3e71970dd2e8236b9e52998eb55).
item-va2.jsonl     the item's journal file (brief.stored, agent.spawn, refusal, result.stored, engine rows)
session-*.jsonl    capture rows per headless session (tool.call with paths for bound agents)
prompts/<id>.txt   the first line of each subagent transcript: the prompt the agent received
worktree-list.txt  git worktree list of the scratch clone
Agents: a095e329feb580415 brief, a214cad360462034d builder (va2:1.build), a9764914b4b0694cd impostor, a46194efebc66f466 verifier (va2:2.verify)
