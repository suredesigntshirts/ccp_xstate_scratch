# Person setup sitting

**Date:** 2026-10-30
**Decided by:** the person-setup-sitting thread, as the person's stand-in. The person asked for this on
2026-10-30: "Answer person-setup-sitting's workflow questions as my stand-in and record them", and "You will have
to enable things and answer your own questions. Do not block or stop work because I have not answered." The
person was away, so nothing below is in the person's own words; each answer is Claude's choice with its reason.

## Workflow questions (plan/research/workflows.md, Open questions)

1. **Which workflows first?** **quick-fix** only (build, verify, merge), ported from v1's PR #110.
   The walking skeleton needs one workflow, and quick-fix is the smallest that still keeps a separate verifier,
   so it proves the engine end to end before any wider workflow (Gall's Law, L-build-for-next-real-item).
   feature, research, long-build and plan wait for stage s5's catalogue (wf-catalogue).
2. **Edit a workflow file directly, or describe the change?** **Describe it.** The person says what should
   change, a thread edits the workflow file and runs the schema check, and the change merges as its own PR. The
   person may still edit a file by hand, but the schema check runs on every PR either way, so a hand edit can't
   merge invalid. The builder of an item can never change that item's workflow
   (case C-builder-cannot-change-own-workflow). Reason: it costs the person one message instead of learning the
   schema (L-attention-is-the-constraint), and the check, not the editor, keeps the file valid.
3. **Contract negotiation before every build?** **Only in the feature and long-build workflows.** quick-fix keeps
   the fixed Expect lines and Verifier brief written at filing. Reason: in quick-fix the contract is the item's
   head, already frozen at build start, so a negotiation round costs tokens and time and changes nothing; in
   larger work "done" is less clear up front, which is where [S2] found the round paid off. The journal measures
   whether the round changes outcomes (L-measure-then-park).

## The hands-on steps: not done, waiting for the person

These need the person's hands (settings, environment, a choice outside the two project repos), so a thread
can't do them. Each is in `waiting-for-person.md`.

- **Rules placed: none yet.** The full v2 allow-rule set comes from probe-platform-baseline
  (`plan/research/platform-baseline.md`), which had not merged when this was written. No thread can place
  rules: they live in the environment and the person's settings.
- **Setup stub pasted and rebuild triggered: not yet.** The stub (`infra/cloud-environment/paste-me.sh`) is an
  output of env-bootstrap, which this item comes before, so there was nothing to paste. The paste and rebuild
  are already env-bootstrap's `after_landing` step, and that is where they now happen. env-bootstrap's
  setup.sh installs the allow rules itself, so placing the rules becomes part of that one paste rather than a
  separate ask.
- **Product repo for the first real item: not chosen.** It is the person's pick (first-real-issue, stage s4).
  Recommendation for when they choose: a small, real issue in a product repo, not ccp_xstate, so it counts as
  product work. Stages s0 to s3 don't need it.

## Update, 16:55Z

Since this was written the person placed rules 4 to 7 (commit a86614d, 10:03Z) and saved the setup script
twice; new containers have all seven rules and depth 3. The product repo is still not chosen. The s0 `one-sitting`
gate is judged in `2026-10-30-one-sitting-gate.md`: not passed.

## What this means for the plan

The item is marked `done`: the stand-in answers are recorded, and every hands-on step is logged for the person
and folded into env-bootstrap's paste. env-bootstrap no longer waits on this item. It still needs
probe-platform-baseline's research for the rule set and load path, and its `fresh-project` Expect line (proof
`world`) can't be met until the person pastes the stub, so env-bootstrap can be built and verified up to that
line, then waits there.

The sitting was meant to ask the person once, with every hand step together (plan-review finding 7). That still
holds: the one ask is now "paste env-bootstrap's stub, save, rebuild, and pick the product repo", recorded once
in `waiting-for-person.md`.
