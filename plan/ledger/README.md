# The learnings ledger

What v1 (the harness in `suredesigntshirts/ccp_machine`, 26 to 30 Oct 2026) taught us, one row per lesson.
Every row ends in a **fate**: what v2 does with the lesson. Items cite rows by id in `serves`, and step 6 of
the plan checks that every row with a fate other than `drop` is served by at least one item.

Each row stands on its own. Evidence names v1 issues and PRs (`ccp_machine#72`), which stay on GitHub, and
paths in the v1 project's Library (`Library: notes/...`), which this project cannot read. So the row says
what the evidence showed, not just where it is.

## Fates

| Fate | Meaning |
|---|---|
| `test` | A case or test v2 must pass. Usually also a file in `plan/cases/`. |
| `design` | Shapes how v2 is built. An item's prose says how it honours the row. |
| `setup` | Something in place before a session starts (allow rules, install, rebuild). |
| `measure` | Something the observability stage must record, so we can see whether it recurs. |
| `drop` | Doesn't apply to v2, with the reason. Kept so nobody relearns it. |

## Files

- [trust.md](trust.md): where facts come from, who did what, self-reported events
- [platform.md](platform.md): auto mode, settings, plugins, mods, containers, the Library mount
- [process.md](process.md): Expect lines, verification, replanning, the person's attention, the stand-in
- [observability.md](observability.md): ledgers, binding, freshness, versions, pages
- [data.md](data.md): the store's format, history, replay
- [growth.md](growth.md): how the code grew, and the rules for keeping it small

## Row format

```
### L-<slug>
**Lesson:** one sentence.
**Evidence:** what happened, with refs.
**Fate:** test | design | setup | measure | drop, with one line on how.
```
