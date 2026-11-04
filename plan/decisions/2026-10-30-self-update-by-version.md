# self-update-by-version: how a release is made and how a session learns of it

**Date:** 2026-10-30, by the self-update-by-version build thread, on the person's standing instruction to decide
two-way doors and not wait. All of these are workflow, script or plugin code and can be changed by a later PR.

0. **A release is a branch `release/harness-v<x.y.z>` that the merging thread pushes, or a tag of the same name.**
   (Revised 16:35Z.) Actions minutes for private repos ran out at about 12:19Z, so release.yml can't be relied on,
   and the git proxy drops tag pushes and ref deletions from threads (seen again 16:31Z on the scratch repo) but
   lets branch pushes through. Every reader takes both kinds as one series by version. release.yml stays as the
   optional path for when Actions runs. The person can also publish a GitHub release in the web UI to get a tag.
   A release branch can't be deleted from a thread either, so it's as fixed as a tag in practice.
1. **The ref name is the version; no bump commit.** The release ref names the merged sha `harness-v<x.y.z>` and
   nothing is committed. A bot commit to `main` would race thread merges and break once `main` is
   protected (waiting-for-person.md). `setup.sh` writes the tag's version into the installed copy's `plugin.json`,
   so the fingerprint and the journal's `release` field show the release. The repo's `plugin.json` version is the
   floor: the next release is the newest tag's patch + 1, or that version when it is higher (a minor or major bump
   is made by editing it in a PR). This replaces env-bootstrap decision 2's "matching plugin.json".
2. **What counts as a plugin change:** anything `setup.sh` copies into a session, so `plugins/harness/` and
   `packages/journal/`, minus their `test/` folders. A docs-only or test-only merge makes no release.
3. **The base is the newest release**, not the merge's parent, so a change whose release was missed is released
   by the next run. With no release yet, the base is the merge's first parent (or Actions' before sha); this PR's
   merge is released as `harness-v0.1.0` (the manifest's version) by this thread, clearing the "no release tag" line
   in waiting-for-person.md without a person.
4. **The record is a `ci.result` row**, validated against the journal schema: printed by the script for the thread
   to journal, and in a tag's annotation when Actions makes it. Actions can't write the project's journal mount.
5. **The behind-notice reminds, it doesn't update.** At most once per 30 minutes per session, and every time that
   window passes while a newer release is out. v1 fast-forwarded its checkout from the hook; v2 can't, because
   the running copy is the plugin the session runs (L-no-self-modification). Its timestamp lives in
   `$CCP_HARNESS_STATE` (default `$TMPDIR/ccp-harness`), never under the plugin root.
6. **The clone fast-forward is v1's rule set, in `setup.sh`:** tracked files clean, and on a branch tracking
   `origin/main` or detached at an ancestor of it. Thread containers check out a `claude/...` branch, so there it
   logs why it skipped; it matters for clones left on `main`.
7. **`setup.sh` won't replace the running plugin.** When `CLAUDE_PID` names a process whose HOME is this HOME (a
   session running the script on itself), it leaves `~/.claude/skills/ccp-harness` alone and says so.
