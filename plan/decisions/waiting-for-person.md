# Waiting for the person

One line each: what, why, which item waits. Threads add to this; the person clears it.

- Product repo for the first real issue: chosen by the stand-in on 31 Oct (ccp_machine_test, a jsonl-lint tool;
  `2026-10-31-first-real-issue-product-repo.md`). Say if you want another repo. What waits on you is the merge card
  quick-fix puts up for it: only your tap merges it.
- Protect `main`: require the `ci / test` and `verdict / gates` checks before merge (repo settings). Until then the
  gates are red marks threads respect, not a lock (plan item repo-skeleton).
- Optional: add an `ANTHROPIC_API_KEY` repo secret if you want the clean-room job to start a real headless `claude -p`
  session. Without it the job runs the plugin's hooks with no model, which tests the install the same way
  (plan item clean-room-install-test; `2026-10-30-clean-room-hooks-without-model.md`).
- Thread branches are named `claude/...` by the environment, so threads can't follow CLAUDE.md's `<kind>/<item-id>`
  branch rule; they name the item in the PR body instead. Change the environment if you want the branch rule kept
  (plan item repo-skeleton).
- Should the v2 plugin's SessionStart hook also write the repo's settings into `~/.claude/settings.json` (taking effect from the next resume), or only check and report? A thread can't do it for itself: tried 11:34Z, refused [Self-Modification]. Until you choose, setup-script/env-bootstrap build the check only (plan/research/platform-baseline.md, "Setup script vs SessionStart").
- Mods a thread writes load only after you answer "Turn on the mods Claude writes in this session?" in that session. So engine-host ships as an installed plugin (plan/decisions/2026-10-30-setup-script-vs-sessionstart.md); installing it to the account is yours when engine-host is ready.
- Optional: let threads read ccp_machine's GitHub REST (attach ccp_machine to the project, or allow api.github.com for it).
  Threads can clone it, but the proxy refuses its REST (403), so no thread can read #72's check runs. Until then the
  rework view is proved on this repo's PRs (plan item obs-time-and-rework; `2026-10-30-obs-time-and-rework.md`).
- Re-save the environment's setup script (any change, even a comment), so the next thread gets a new container and
  installs harness-v0.1.9. New threads resume a snapshot from 16:46Z that holds 0.1.0 and skip `setup.sh`, so no
  thread has ever run capture. Stage s1's gate waits on it (`2026-10-30-s1-observability-gate.md`).
- Open the observe page (https://claude.ai/artifact/GEVcccpqcToRUb7EhTG4B3) after the re-save and a thread or two, press
  Refresh, and say whether any answer is missing. That is s1's `answers` check, and obs-page's after-landing step.
- Add the allow rule engine-effects names: "The host may merge a PR at the verified head (`expectedHeadSha` = the
  verdict's sha) after an independent PASS and green CI" to the repo's autoMode.allow (a settings change). The host's
  merge effect runs without it today, inside its own process; the rule covers a session running `bin/host.js` by Bash
  (`2026-10-30-engine-effects.md`).
- Optional: the toy-2 merge card (scratch PR #24) in the engine-toy-run thread is still open. The toy run is proved on
  toy-v1 (your tap at 02:24Z merged scratch #26), so tap it or leave it (`2026-10-30-engine-toy-run.md`).
- Add an allow rule for the product repo the stand-in works in (ccp_machine_test): with none, a thread's `gh api`
  write there was refused while the GitHub MCP tool and the headless builder were not (ledger L-allow-rules-per-repo,
  `plan/research/retro-first-item.md` finding 5). A settings change.
- second-workflow: pick the second real item and the workflow it runs through (feature or research). It stays a
  draft until you choose, and parity-compare waits on it (plan item second-workflow).
