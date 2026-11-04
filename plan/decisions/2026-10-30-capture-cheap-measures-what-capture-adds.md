# The "cheap" check measures what capture adds, not Node's start

**Date:** 2026-10-30, by the thread fixing main's red ci, on the person's standing instruction to decide two-way doors
and not wait.

**What broke.** obs-live-capture's Expect `cheap` says "Capture adds at most 50 ms median and 200 ms at the 95th
percentile per tool call", and `verify/obs-live-capture/capture.test.mjs` checked it as the median of the fixture
run's `hook.run` `ms` against 50. On GitHub's runners that median came out at 53 ms (main run 41108650474 at 8d508c9,
and the obs-refusal-log merge run 41106743849), so ci went red on main and on every PR.

**What was measured** (this container, Node 22.22, 5 fixture passes, 70 hook runs each):

- Refusal-log (PR #29) did not slow the hook. At b1d8df6, before it merged, and at main the median was the same,
  36 to 39 ms either way.
- `hook.run` `ms` is `performance.now()` at the end of the hook, so it counts from the process's start. A bare
  `node` that only prints `performance.now()` takes a median 19 ms here, and an empty ES module 24 ms wall. Capture's
  own part is the other 18 ms or so: about 10 ms loading its modules and 8 ms of reads and appends.
- Nothing in that part is one big cost. Loading builtins without their ES module facade
  (`process.getBuiltinModule`), reading the marker, stdin and the journal library in parallel, and switching each
  file over moved the median by 1 to 2 ms, inside the run-to-run noise. So the hook is not made cheaper here: there
  was nothing real to cut, and a change that saves nothing would only cost a new verification for show.
- The runner is slower than this container across the board (Node's own start included), which is the 53 ms.

**Choice:** the verifier's test measures what the Expect line says capture *adds*: the median `hook.run` `ms` minus
the median start of a bare `node` measured the same way, on the same machine, in the same test, must be at most
50 ms. The 95th percentile stays an absolute 200 ms on the raw `ms`, so a slow outlier still fails. The Expect line
and the item head do not change; only the test's reading of "adds" does, and it is redone by a verifier, with a new
verdict, in the same PR.

**Why not raise the threshold?** A higher absolute number still mixes Node's start with capture's work, so it goes
red on a slower runner and hides a slower capture on a faster one. Subtracting the baseline tracks capture's own cost
on any machine.

**What it costs:** the bar is looser on a slow runner than the old absolute one (about 18 ms of capture work against
50, instead of about 38 ms total against 50). Tool-call capture runs async (plan/decisions/2026-10-30-capture-by-hooks.md),
and the obs-live-capture verifier measured 610 ms against 606 ms per call with and without the plugin, so the time a
call actually waits was never near the limit. Reversible: the test can go back to the absolute bar at any time.

**Then the p95 went red on CI** (206 ms against 200, run 41111180678). With 14 hook runs the 95th percentile is the
slowest one, SubagentStop, which waited for 150 ms of quiet on the subagent's transcript even when the transcript
was already complete. That wait was real waste, so it is cut: SubagentStop now stops waiting as soon as the
transcript ends with the result of the agent's SubagentHandback call, the last line Claude Code writes for it, and
keeps the 150 ms quiet wait only for an agent that never hands back. The fixture's SubagentStop went from about
190 ms to about 40 ms here. The 200 ms p95 bar stays as it was.
