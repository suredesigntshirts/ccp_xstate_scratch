# How the quick-fix workflow is ported

**Date:** 2026-10-30
**Decided by:** the wf-quick-fix thread (two-way doors; the person was away)

- **Ported from ccp_machine branch `claude/project-thread-3kdqwr` at 1dc495e** (PR #110): `item.machine.json`
  became `workflows/quick-fix.json`, and `src/spec.js` and `src/schema.js` became `packages/engine/src/`. The
  thread could read the branch with a plain `git clone`; no project setting changed.
- **One change to the machine.** In #110, `replanning`'s answer "replan" with no written why fell through to
  `dropped`. C-second-fail-replans says replanning *waits* for a written five whys, so the fall-through now asks
  again (`replanning`, reentered), and `dropped` takes only an explicit "drop" (new guard `drop`). A journal that
  never answered "replan" without a why replays the same. The id changed from `item` to `quick-fix`; the state hash
  covers only state and context, so it doesn't change a replay.
- **The start check moved into the engine, not a host.** #110 checked `meta.input` and the first state's needs in
  `Host#refuseStart`. The engine host is a later item (engine-host), so `startRefusal(spec, input)` holds that check
  as a pure function now; C-missing-expect-fails-closed tests it. The machine has no `queued` state: "can't leave
  queued" is "can't start".
- **`replay(spec, entries)` is #110's `Host.replay` without run or timer tracking**: pure transitions and the same
  `hashOf`, so a journal #110 wrote replays here entry by entry. Runs, timers and stale-run refusal stay with
  engine-host.
- **Not ported:** `host.js`, `driver.js`, `step.js`, the sandbox actors, the inspector and the page (item
  non-goals, and later items engine-host, engine-actors, obs-page).
- **CI runs `npm ci`.** xstate is the first runtime dependency, so `ci.yml` installs from `package-lock.json`, and
  `node_modules/` is ignored.
- **Tests on pure transitions:** XState's `initialTransition`/`transition` over the machine, with completion
  events built by hand (`xstate.done.actor.<id>`). The fail-closed test is built from each guard's own conditions,
  one test per guard, so a guard added later is covered without a new test.
- **`below` holds only for a number.** #110's `value < below` held for `null` (`null < 2`), so `buildsLeft` passed
  with `builds: null`. The verifier found it; every other condition already treated null as absent.
- **#110's journal is a committed fixture** (`packages/engine/test/fixtures/110-demo/`). No recorded run existed on
  any ccp_machine branch. The person approved running #110's real demo in this thread (2026-10-30 16:54Z) after auto
  mode had refused it unasked, and the recording is kept so no later item needs to run ccp_machine again.
