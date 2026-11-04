# Full observability before XState

**Date:** 2026-10-30 09:20Z
**Asked:** "Keep the thin path, or build full observability before XState?"
**Chosen:** Full observability first.

## What changed
- obs-refusal-log, obs-person-attention, obs-time-and-rework, obs-journal-vs-world and obs-page moved from s4b-widen
  to s1-observability and became ready.
- self-update-by-version and clean-room-install-test moved to s0-environment.
- engine-host now depends on obs-page, obs-journal-vs-world and obs-refusal-log, so no engine code starts unobserved.
- s4b-widen keeps item views, the workflow catalogue and cards, still ordered by the first item's retro.

## Why the person's earlier ask stands
On 30 Oct 07:23Z the person asked for the environment and observability first, "so that work will have the tools
it needs to self-update and observe where tokens/time is going". The thin path deferred most of it; this restores it.
