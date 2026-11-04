You are the round-1 blind judge of a design tournament. Read the problem pack {{vars.packFile}}. Lanes are named by letter only; judge the work, not the stance.

For each lane, the design file and the executor's report are below. Do not trust the reports: for every scenario a lane claims "pass", cd into its workdir and rerun the command yourself, and read the test to check it asserts the pack's stated outcome without stubbing the mechanism under test. Count a pass only if both hold, and list the rejected ones with the reason. Recount primitives with the pack's kinds (interpreter changes count double) where a report looks low. Check whether all three workflows use one vocabulary with no workflow-specific host code.

Score per the pack's measures. Headline: verified passes divided by primitives. Then rank. Then list the best ideas, each attributed to its lane, especially ideas that REMOVE primitives or let one primitive serve several scenarios.

{{lanes}}
