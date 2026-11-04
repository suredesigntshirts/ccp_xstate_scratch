# How other agent harnesses shape their workflows

**Question.** v1 ran one fixed flow: issue, triage, plan, build, verify, accept, land. The person wants v2's
workflow to follow what other agent harnesses do well, to be easy to change, and to differ by type of work.
What do the current harnesses do, and what should v2 take from them?

Researched 2026-10-30 from the sources at the end. Several are secondary write-ups; claims that rest on one
secondary source are marked *(secondary)*.

## What each one does

| Harness | Shape of the work | What carries state | How "done" is checked | Notable |
|---|---|---|---|---|
| Anthropic, long-running agents [S1] | An **initializer** session sets up the environment once, then a **coding agent** does one feature per session | `feature_list.json` (200+ features, all `passes: false` at first, and only `passes` may change), `claude-progress.txt`, git, `init.sh` | End-to-end checks through browser automation, "as a human user would". Unit tests and curl weren't enough | Each session starts by reading progress and git, then runs a smoke test before new work. JSON was chosen because the model is less likely to rewrite it than Markdown |
| Anthropic, harness design for long-running apps [S2] | **Planner** → **generator** → **evaluator**, at first in sprints | Files the agents write to each other, and a handoff file on context reset | Before coding, the generator proposes a **sprint contract** (what done means and how it is checked), and the evaluator agrees. The evaluator uses Playwright and fails a sprint if any criterion falls below its threshold | "Tuning a standalone evaluator to be skeptical turns out to be far more tractable" than self-critique. On a newer model the sprints were removed and the evaluator ran once at the end. "Every component in a harness encodes an assumption about what the model can't do on its own." A full run cost 20× a solo run but worked where the solo run didn't |
| Anthropic, building effective agents [S3] | Five composable patterns: prompt chaining (with gates), routing, parallelization, orchestrator-workers, evaluator-optimizer | Up to the builder | Gates between steps, and an evaluator loop when criteria are clear | "Start with the simplest pattern that works" |
| Superpowers (obra) [S4] | brainstorming → git worktree → writing-plans (2-5 minute tasks with exact files and checks) → **subagent-driven development** (a fresh subagent per task, then review for spec compliance, then for code quality) or executing-plans (inline) → TDD → code review between tasks → finish branch | Design doc, plan file, worktree branch | Red-green TDD (code written before its test is deleted), "evidence over claims", critical review findings block | The user picks thorough (subagent per task) or cheap (inline). Skills trigger by themselves |
| GitHub Spec Kit [S5] | constitution → specify → (clarify) → plan → tasks → implement, with gates between phases | One folder per feature: spec.md, plan.md, research.md, data-model.md, contracts/, tasks.md | Checklist and analyze gates *(secondary)* | The spec is the stable "what", the plan and tasks are the flexible "how". GitHub calls it an experiment |
| Kiro [S6] | requirements (EARS: "WHEN … THE SYSTEM SHALL …") → design → tasks | `.kiro/specs/<feature>/`, and steering files for standing rules | Tasks trace to requirements | Hooks run agent actions on file events. Steering carries standards into every run |
| BMAD method [S7] | **Scale-adaptive**: a quick flow (quick spec → quick dev) for fixes and small features, and the full method (analysis, PRD, architecture, stories) for larger work | Phase documents | Per phase | Picks the ceremony by the size of the work. Thresholds differ between versions *(secondary)* |
| OpenAI, harness engineering with Codex [S8] | Engineers design environments and feedback loops. Agents open PRs and iterate until criteria are met | A short AGENTS.md (about 100 lines) as a map into `docs/`, the system of record. **Execution plans** with progress and decision logs, checked in (`active/`, `completed/`) | Structural tests and linters enforce architecture layers mechanically. Agents read logs, metrics and spans | About a million lines with no hand-written code over five months *(secondary)* |
| GitHub Agentic Workflows [S9] | A workflow is a Markdown file with a YAML head (triggers, permissions, safe outputs), compiled to an Actions workflow | The repo | Compile-time validation, and approval gates for critical operations | The **agent is read-only**. Every write goes through declared, sanitized **safe outputs** |
| Ralph loop [S10] | `while :; do cat PROMPT.md \| claude; done`: fresh context every round | Files and git only | Tests | Shows that state on disk plus a fresh context can carry long work |
| Claude Code dynamic workflows (Library copy of the docs) | A script calls `agent()` steps with schemas, in pipeline or parallel | Script variables and a journal of each agent's result | Schema-validated returns | No mid-run input, and resume only within one session, so it fits one fan-out stage, not a long flow with human gates (ledger L-dynamic-workflows-limits) |

## What they agree on, and where v1 stands

| Pattern | Who does it | v1 | For v2 |
|---|---|---|---|
| **The what before the how.** A spec or design is agreed before a plan, and the plan before code | Spec Kit, Kiro, Superpowers, BMAD, the planner in [S2] | The issue held the "what", and plans were thin (median 73 words, often written after the PR, audit F8) | A spec or design state in workflows that need one. Its output is a file the next state reads |
| **Small tasks in fresh context.** One feature per session, or 2-5 minute tasks per subagent | [S1], Superpowers, Ralph | One builder did a whole item in one context | A builder may split its item into tasks, each a fresh subagent. This is a workflow choice, not engine code |
| **A contract before the build.** "Done" and how it is checked are agreed first | [S2] sprint contracts, Kiro EARS, Spec Kit checklists | Expect lines were set by the filer, and the verifier brief was fixed before the build | Keep the fixed verifier brief, and add an optional step where builder and verifier agree the contract before code |
| **A separate, skeptical evaluator** that tests behaviour, not just unit tests | [S1], [S2], Superpowers' two-stage review | Independent verifier on a different model | Keep. Add behaviour testing where the work has a UI. Calibrate the evaluator by reading its logs ([S2]: "out of the box, Claude is a poor QA agent") |
| **State in files and git, and a startup routine** that reads it and runs a smoke test | [S1], Ralph, OpenAI exec plans | The store held state, but no per-session smoke test | Stage 0's self-check is this. Each worker's brief starts with read state, then smoke test |
| **Progress as data the agent can't quietly rewrite** | [S1] feature list in JSON, only `passes` flips | Agents wrote their own events | Agents never write state. The host does, from completions (ledger L-agents-self-report) |
| **Plans as checked-in artifacts with progress and decision logs** | OpenAI exec plans, Spec Kit, Superpowers | Plans in the store, briefs not durable | This plan folder, and each item's folder in the journal |
| **The agent proposes, the harness writes** | GitHub Agentic Workflows' safe outputs | Agents called `gh` directly, and gates parsed Bash | Host effects only: workers return results, and the host merges, posts and labels (ledger L-text-is-not-intent) |
| **Ceremony scales with the work** | BMAD tracks, Superpowers' two modes, [S3]'s "simplest pattern that works" | One flow, with tiers that skipped gates. Tiers were self-chosen and drifted (audit F4) | **A choice of workflows per type of work**, picked at filing by someone other than the builder |
| **Ratchet:** every failure becomes a rule, hook or check | OpenAI, Osmani [S11] | Many guards, mostly sender checks | The ledger. Each new rule cites the failure that caused it |
| **Scaffolding encodes model weakness, so remove it when models improve** | [S2] (sprints dropped on a newer model), [S11] | Nothing was ever removed | Workflows as data make a step cheap to drop. The journal measures whether each step changes outcomes |
| **Fresh context with a handoff file beats compaction for long work** (model-dependent) | [S2], [S11], Ralph | Long-lived leads hit timeouts and stale state | Prefer short-lived workers with handoff files. The host is the long-lived part, and it holds no conversation |

## What this means for v2's workflow model

1. **A workflow is a data file**, validated by one schema. It names states, the actor each state invokes (role,
   model, brief template, output schema), the gate on each transition (a precondition on context), the card
   for each waiting state, and limits (rounds, budget, concurrency). The engine runs any valid file. This is
   ledger L-rules-in-spec-not-host applied to the whole flow.
2. **Workflows compose from stage fragments.** "Verify a PR at a head", "merge at a verified head" and
   "replan after the second FAIL" are reusable sub-machines (XState invoked child machines). A new workflow
   mostly picks fragments.
3. **A first catalogue, from the research.** The person picks which to build first (stage 2's decision item):
   - **quick-fix:** build → verify → merge. For small fixes, close to BMAD's quick flow.
   - **feature:** spec → contract → plan → build (tasks in fresh subagents) → verify (behaviour) → merge. Close to Superpowers and Spec Kit, with [S2]'s contract.
   - **research:** question → parallel researchers → synthesis → independent check → report. What v1 did by hand for the root-cause audit.
   - **long-build:** planner → generator → evaluator against a contract, for work bigger than one PR. [S2]'s shape.
   - **plan:** what this thread is doing now: ledger → items → independent review.
4. **Selection is recorded with its source.** The person or a triage actor picks the workflow when work is
   filed. It is never the builder (ledger L-builder-supplies-gate-inputs). The journal keeps which workflow
   ran, so outcomes can be compared per workflow.
5. **Steps earn their place.** Every step's cost (tokens, time, person taps) and effect (did it change the
   outcome: FAILs caught, rework avoided) is measured. A step that never changes an outcome over N items is
   flagged for the person to review. Nothing is removed automatically (ledger L-measure-then-park).

## Open questions for the person

- Which workflows first? The walking skeleton needs only one. quick-fix is the smallest that still has a separate verifier.
- Should the person be able to edit a workflow file directly, or describe the change and have a thread make it and run the schema check?
- Contract negotiation ([S2]) costs a round before every build. Default on, or only in the feature and long-build workflows?

## Sources

- [S1] Anthropic, "Effective harnesses for long-running agents" (Nov 2025). https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- [S2] Anthropic, "Harness design for long-running application development" (Mar 2026). https://www.anthropic.com/engineering/harness-design-long-running-apps
- [S3] Anthropic, "Building effective agents". https://www.anthropic.com/research/building-effective-agents
- [S4] obra/superpowers README. https://github.com/obra/superpowers
- [S5] GitHub Spec Kit, via Visual Studio Magazine and Plannotator docs. https://visualstudiomagazine.com/articles/2025/09/03/github-open-sources-kit-for-spec-driven-ai-development.aspx , https://docs.plannotator.ai/frameworks/github-spec-kit
- [S6] Kiro docs. https://kiro.dev/docs/getting-started/first-project/
- [S7] BMAD method concepts. https://www.mintlify.com/bmad-code-org/BMAD-METHOD/concepts
- [S8] OpenAI, "Harness engineering: leveraging Codex in an agent-first world" (Feb 2026), via InfoQ (the original page refused our fetch). https://www.infoq.com/news/2026/02/openai-harness-engineering-codex , https://openai.com/index/harness-engineering/
- [S9] GitHub Agentic Workflows (gh-aw) README. https://pkg.go.dev/github.com/githubnext/gh-aw
- [S10] Ralph Wiggum loop, Geoffrey Huntley, via codecentric. https://codecentric.de/en/knowledge-hub/blog/the-ralph-wiggum-loop-autonomous-code-generation-with-a-fresh-context
- [S11] Addy Osmani, "Agent harness engineering". https://addyosmani.com/blog/agent-harness-engineering/
