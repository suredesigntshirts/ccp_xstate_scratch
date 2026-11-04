#!/usr/bin/env node
// The actor hooks (plan item engine-actors): how the harness starts an invoked actor's agent, keeps it in its
// worktree and checks what it returns. The logic is packages/engine/src/actors.js; this file reads the hook input,
// calls it and answers Claude Code. In a project that hasn't installed the harness it does nothing.
//
//   PreToolUse of Agent with the prompt `ccp-run <run>`: swap in the run's brief, or refuse an unknown or started run.
//   PreToolUse of the return tool: refuse unless the caller, the schema and GitHub check out; then hand the result to
//     the item, which prepares the runs its next state invokes.
//   PreToolUse of any other tool a bound agent calls: run shell commands from its worktree, refuse file tools outside.
//   SubagentStart: bind the agent to its run and give it its run, worktree and return instructions. When the session
//     has several runs starting at once, the agent is bound at its first tool call instead, from its meta.json.
//   SubagentHandback, or SubagentStop, of a bound agent whose run has no result: send it back once to call the return
//     tool; the next time it ends, fail the run, so the item gets the actor's error instead of waiting (plan item
//     engine-actor-returns). A stop after a handback fails at once: a block doesn't bring that agent back.
//   PostToolUse of Agent in the main session, and UserPromptSubmit (a wake, such as a background agent finishing):
//     say which runs are prepared and waiting for their agent.
//
// A refusal is a PreToolUse deny whose reason starts with its rule (`wrong-caller: ...`), journalled in the item's
// file. A call it adds nothing to gets no output, so the normal permission flow still decides it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { engine, gate, journalDir, sessionName, stdin } from './host.mjs';
import { handedBack, read } from './capture-rows.mjs';

const out = (hookSpecificOutput) => process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
const deny = (reason) => out({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason });
const rewrite = (updatedInput) => out({ hookEventName: 'PreToolUse', updatedInput });

// The Agent call that started a subagent, from its meta.json beside the session transcript. It exists from the
// agent's first tool call on, not yet at SubagentStart.
function spawningToolUse(input) {
  if (!input.transcript_path || !input.agent_id) return null;
  try {
    return JSON.parse(readFileSync(`${input.transcript_path.replace(/\.jsonl$/, '')}/subagents/agent-${input.agent_id}.meta.json`, 'utf8')).toolUseId ?? null;
  } catch {
    return null;
  }
}

// Runs prepared in any item and not yet started, for the main session's next Agent call.
function waitingRuns(A, root) {
  let items = [];
  try {
    items = readdirSync(join(root, 'items'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {}
  return items.flatMap((item) => A.waiting(root, item));
}

// Hands a failed run's error to its item, which steps back.
async function deliverFailed(A, root, run) {
  const { github } = await engine('effects/github.js');
  await A.deliver({ root, run, github: github({ ...(process.env.CCP_GITHUB_API ? { api: process.env.CCP_GITHUB_API } : {}) }) });
}

async function main() {
  const text = await stdin(2000);
  if ((await gate()) !== 'installed') return;
  const input = JSON.parse(text);
  const root = journalDir();
  const A = await engine('actors.js');
  const session = sessionName(input);
  const event = input.hook_event_name;
  const tool = input.tool_name;

  if (event === 'PreToolUse' && tool === 'Agent') {
    const r = A.spawn({ root, prompt: input.tool_input?.prompt, toolUseId: input.tool_use_id, session: input.session_id ?? null });
    if (!r) return;
    if (r.deny) return deny(r.deny);
    return rewrite({ ...input.tool_input, prompt: r.prompt });
  }
  if (event === 'PreToolUse' && A.isReturnTool(tool)) {
    const { github } = await engine('effects/github.js');
    const gh = github({ ...(process.env.CCP_GITHUB_API ? { api: process.env.CCP_GITHUB_API } : {}) });
    const got = await A.accept({ root, caller: input.agent_id ?? null, run: input.tool_input?.run, result: input.tool_input?.result, toolUseId: input.tool_use_id, github: gh, session });
    if (got.refused) return deny(`${got.refused.rule}: ${got.refused.reason}`);
    await A.deliver({ root, run: got.accepted.run, github: gh });
    return;
  }
  if (event === 'PreToolUse' && input.agent_id) {
    const late = A.bindLate({ root, agentId: input.agent_id, metaToolUseId: spawningToolUse(input), agentType: input.agent_type ?? null, session });
    if (late?.deny) return deny(late.deny);
    // Bound only now (SubagentStart couldn't tell which run): this call doesn't run, so the agent reads its run first.
    if (late?.bound) return deny(`bound: you are an invoked actor; this call did not run. Read this, then make it again.\n${late.bound.context}`);
    const bound = A.boundRun(root, input.agent_id);
    if (!bound) return;
    if (tool === 'SubagentHandback') {
      const h = A.handback({ root, agentId: input.agent_id, session });
      if (h?.deny) return deny(h.deny);
      if (h?.failed) await deliverFailed(A, root, h.failed);
      return;
    }
    const c = A.confine({ worktree: bound.worktree, tool, input: input.tool_input });
    if (c?.deny) return deny(c.deny);
    if (c?.input) return rewrite(c.input);
    return;
  }
  if (event === 'SubagentStop' && input.agent_id) {
    const tail = input.agent_transcript_path ? read(input.agent_transcript_path, { from: null, cap: 256 * 1024 })?.text ?? '' : '';
    const r = A.stopped({ root, agentId: input.agent_id, again: input.stop_hook_active === true, handedBack: handedBack(tail), session });
    if (r?.block) return process.stdout.write(JSON.stringify({ decision: 'block', reason: r.block }));
    if (r?.failed) await deliverFailed(A, root, r.failed);
    return;
  }
  if (event === 'SubagentStart') {
    const toolUseId = A.startedRun({ root, session: input.session_id ?? null });
    const r = A.bind({ root, agentId: input.agent_id, toolUseId, agentType: input.agent_type ?? null, session, via: 'start' });
    if (r) out({ hookEventName: 'SubagentStart', additionalContext: r.context });
    return;
  }
  // After an Agent call, or a wake such as a background agent's task notification: name the runs waiting.
  if ((event === 'PostToolUse' && tool === 'Agent' && !input.agent_id) || event === 'UserPromptSubmit') {
    const runs = waitingRuns(A, root);
    if (!runs.length) return;
    const lines = runs.map((r) => `- ${r.actor} for ${r.run}: Agent tool with prompt exactly "${r.prompt}"`);
    out({ hookEventName: event, additionalContext: `ccp-harness: actor runs prepared and waiting for their agent:\n${lines.join('\n')}` });
  }
}

// A failure here must not break the session's tool call: it is reported on stderr and the hook exits 0, so the
// call goes on as if the hook were absent (and a return no hook accepted is refused by the return tool itself).
main().catch((error) => process.stderr.write(`ccp-harness actors: ${error?.message ?? error}\n`));
