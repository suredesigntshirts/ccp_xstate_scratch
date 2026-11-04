# obs-page: what a session can prove about a published page

**Date:** 2026-10-30, 19:15Z
**Decided by:** the obs-page thread (a two-way door; the person was away)

The `live` Expect asked the verifier to open the published page, press Refresh and watch it read the journal. A
session can publish the page and read it back (the Artifact tool's `read`), and read the page's store (ArtifactData),
but it cannot open a claude.ai page as a signed-in viewer: the page is private to the person, headless Chromium has
no claude.ai sign-in, and the person's own Chrome (Claude in Chrome) needs the person to pick a browser first. The
`files` and `db` capabilities exist only inside claude.ai's viewer frame, so nothing outside it can run them for real.

So the line is split where the platform splits it. The verifier proves, from the world, that the published page is
the built file with the `files` capability on this project, and proves the page's behaviour by opening that same file
in Chromium with a stand-in viewer (files from a copy of the project's journal, an in-memory store), appending a row
and pressing Refresh. The one step only a viewer can take, a real Refresh writing a real `page.refresh` row to the
page's store, becomes a person prerequisite, which the s1 stage gate already asks for (the person looks at the page).

If a later platform lets a session view an artifact as its owner, this line goes back to the verifier.
