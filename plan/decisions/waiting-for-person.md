# Waiting for the person

One line each: what, why, which item waits. Threads add to this; the person clears it.

- Pick the product repo for the first real issue (plan item first-real-issue). Stage s4 waits; s0-s3 run without it.
- Protect `main`: require the `ci / test` and `verdict / gates` checks before merge (repo settings). Until then the
  gates are red marks threads respect, not a lock (plan item repo-skeleton).
- Optional: add an `ANTHROPIC_API_KEY` repo secret if you want the clean-room job to start a real headless `claude -p`
  session. Without it the job runs the plugin's hooks with no model, which tests the install the same way
  (plan item clean-room-install-test; `2026-10-30-clean-room-hooks-without-model.md`).
- Thread branches are named `claude/...` by the environment, so threads can't follow CLAUDE.md's `<kind>/<item-id>`
  branch rule; they name the item in the PR body instead. Change the environment if you want the branch rule kept
  (plan item repo-skeleton).
- The setup sitting, in one go once env-bootstrap merges: paste `infra/cloud-environment/paste-me.sh` into the
  project's environment setup script, save, and start one fresh thread so it rebuilds. That paste places the full
  v2 allow-rule set from probe-platform-baseline. Pick the product repo in the same sitting (plan items
  person-setup-sitting, env-bootstrap; see `person-setup-sitting.md` here).
- Should the v2 plugin's SessionStart hook also write the repo's settings into `~/.claude/settings.json` (taking effect from the next resume), or only check and report? A thread can't do it for itself: tried 11:34Z, refused [Self-Modification]. Until you choose, setup-script/env-bootstrap build the check only (plan/research/platform-baseline.md, "Setup script vs SessionStart").
- Mods a thread writes load only after you answer "Turn on the mods Claude writes in this session?" in that session. So engine-host ships as an installed plugin (plan/decisions/2026-10-30-setup-script-vs-sessionstart.md); installing it to the account is yours when engine-host is ready.
- No `harness-v*` release tag exists yet, so setup installs the plugin from main's HEAD (fingerprint `tag: null`, self-check release `unknown`). After env-bootstrap merged (PR #15, 08f4723), the thread tried to push `harness-v0.1.0` on it twice, with the intent stated. The git proxy dropped both pushes ("unexpected disconnect"), so threads can push branches but not tags. Either push the tag yourself (`git tag -a harness-v0.1.0 08f4723 && git push origin harness-v0.1.0`), or let self-update-by-version's release workflow make tags from Actions, which is its plan anyway. The s0 fresh-install gate's "latest release" check waits on this (plan items env-bootstrap, self-update-by-version).
- New threads can land in a resume-cached container where the setup script doesn't run (the 12:13Z fresh-install thread did, so it had no plugin and wrote no journal rows). If the next new thread does too, re-save the project's environment setup script so the container rebuilds; that is what got the 11:35Z thread a fresh one (s0 gate fresh-install; `2026-10-30-fresh-install-gate-first-check.md`).
- GitHub Actions can't run in the private repos (minutes used up, said 16:28Z), so `ci` and `verdict` don't run on PRs. Until they do, threads run the same gates themselves and paste the output on the PR (`2026-10-30-releases-and-gates-without-actions.md`). Add minutes or make the repos public to get CI back.
