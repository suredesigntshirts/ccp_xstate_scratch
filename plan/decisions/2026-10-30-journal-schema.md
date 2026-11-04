# How the journal is shaped

**Date:** 2026-10-30
**Decided by:** the journal-schema thread (two-way doors; the person was away)

- **The schema file is the one definition of a row.** With no runtime dependencies allowed, the library reads
  `row.schema.json` with a small validator that covers only the keywords the schema uses, instead of pulling in
  Ajv. A keyword the validator doesn't know is a reason to extend it, not to copy rules into code.
- **Kinds are a writer-side list, not a schema enum.** `append()` refuses a kind not in `KINDS`; the schema only
  checks a kind is dotted lower-case words. An enum would make every older reader reject rows of a kind added
  later. A test keeps `docs/journal.md`'s kinds table equal to `KINDS`.
- **`readFile` returns `{ rows, bad }`**, not only rows. A torn line, a row with no `v`, a row from a newer `v` or a
  schema failure is counted with its line and reason, so nothing is dropped silently (L-placeholders-labelled) and
  one torn line doesn't make a file unreadable.
- **Upcasting is in place, the table is empty.** `readFile` runs rows through `UPCASTERS` up to its version and
  never writes. The item's non-goal holds (no upcaster until a bump needs one); the verifier brief's "old-version
  row is upcast" is checked with a reader given a future version and an upcaster, since no v0 exists.
- **The older-writer check reads the file's tail** from the one descriptor `append()` already has open, and takes
  the last complete row's release. Refusing older writers keeps the last row the newest. Two writers racing on
  their first rows can slip past; one writer per file is the guard.
- **`append()` doesn't create folders.** Making a folder costs extra calls on the slow mount and only happens once,
  so the caller does it.
- **A line is capped at 1 MiB** so it goes out in one write; bigger content belongs in a stored file the row names
  (`brief.stored`, `result.stored`).
- **`placeholder` is an optional envelope field** holding the reason a row stands in for missing data, so health
  checks can count placeholders without a separate kind.
- **v1's history schema was not read.** This session can't reach the ccp_machine repo; the envelope follows the
  item's output list and the data ledger instead.
