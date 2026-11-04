#!/usr/bin/env node
// A hook of ours that denies (plan item obs-refusal-log): any Bash command containing ccp-refusal-probe is denied
// with a reason that names its rule first, "<rule>: why", as every denying hook of ours does. Load it beside the
// harness with --plugin-dir to see the denial become a refusal row with source hook and rule ccp-deny-probe.
let text = '';
process.stdin.on('data', (d) => (text += d));
process.stdin.on('end', () => {
  try {
    if (String(JSON.parse(text).tool_input?.command ?? '').includes('ccp-refusal-probe')) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'ccp-deny-probe: commands containing ccp-refusal-probe are denied by this test hook' },
      }));
    }
  } catch {}
});
