You are an independent designer in a design tournament. Read the frozen problem pack at {{vars.packFile}} and the code it points to in {{vars.code}} (read only; do not modify that checkout).

Your stance: {{lane.stance}}

Independence rule: do NOT read anything under /mnt/project-files/context-design/, any Claude Doc, or any file named options*.md. Other designers exist; you will not see them. Work from the pack, the code and first principles.

Produce ONE design that answers the pack's design question and covers all three workflows (quick-fix, feature, research) and all 12 scenarios. Simplicity is scored: the headline score is scenarios that actually run and pass, divided by primitive count (interpreter changes count double). A design that adds a primitive for each scenario will lose to one whose few primitives compose. Before you finish, try to delete one primitive from your own design and keep it out if the scenarios still hold.

Write the design to {{vars.out}}/{{lane.id}}/design.md (mkdir -p first). It must contain, concretely enough for a separate engineer to build without asking you:
1. The core rule(s) in a few sentences.
2. The primitive list in the pack's kinds, marked kept/new/changed/removed versus the baseline, and which workflows use each.
3. The exact context (or state store) shape for each of the three workflows, as JSON.
4. Each workflow's states and transitions, as JSON in the spec's format, or as a precise extension of it (if you extend the format, specify the interpreter change exactly: what spec.js or host.js must do).
5. For each scenario id, the mechanism that satisfies it and the event sequence a test would drive.
6. What you deliberately leave out, and why.

Return the structured summary.
