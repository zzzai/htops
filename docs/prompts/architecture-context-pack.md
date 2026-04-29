# Architecture Context Pack

Use these context packs when invoking the architecture prompt set.

## arch-review

Goal:

- assess the current architecture
- identify drift, risks, and minimal corrective actions

Load at minimum:

- `AGENTS.md`
- if the subsystem touches semantic routing, clarify flows, AI fallback, or query quality:
  - `docs/reviews/2026-04-17-ontos-for-htops-review.md`
  - `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md`
  - `docs/plans/2026-04-17-semantic-quality-loop-design.md`
- relevant `docs/plans/*design*.md`
- owner modules for the feature or subsystem under review
- relevant test files
- if production behavior matters: doctor output, queue snapshot, scheduler snapshot, and recent logs
- if query path behavior matters: `scripts/summarize-route-compare.ts` output and `scripts/summarize-hermes-frontdoor.ts` output

Default artifact target:

- `docs/reviews/YYYY-MM-DD-<topic>-review.md`

## arch-design

Goal:

- design a new subsystem, major refactor, or bounded evolution path

Load at minimum:

- `AGENTS.md`
- if the design touches semantic routing, multi-turn context, or AI-assisted understanding:
  - `docs/reviews/2026-04-17-ontos-for-htops-review.md`
  - `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md`
  - `docs/plans/2026-04-17-semantic-quality-loop-design.md`
- existing architecture design docs
- current owner modules
- any known constraints, incidents, or migration deadlines

Default artifact target:

- `docs/plans/YYYY-MM-DD-<topic>-design.md`

## arch-retro

Goal:

- explain why the current architecture failed, drifted, or caused avoidable cost

Load at minimum:

- incident summary or operator report
- if the incident involves routing drift, clarify failures, or semantic misclassification:
  - `docs/reviews/2026-04-17-ontos-for-htops-review.md`
  - `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md`
  - `docs/plans/2026-04-17-semantic-quality-loop-design.md`
- scheduler and queue state snapshots if relevant
- affected logs
- touched modules
- prior design docs or ADRs for the same subsystem

Default artifact target:

- `docs/reviews/YYYY-MM-DD-<topic>-retro.md`

## Context Rules

1. Prefer the smallest context pack that preserves truth.
2. Include durable documents before chat summaries.
3. If logs are large, summarize first and attach only the key slices.
4. Always distinguish:
   - current state
   - desired state
   - verified facts
   - inferred risks
5. When route or latency is under review, prefer summarized observability artifacts before raw journals.
6. When semantic architecture is under review, treat Ontos-lite as the approved bounded direction:
   - capability graph remains the business semantic truth source
   - semantic state and quality loop are supporting control-plane layers
   - do not infer approval for a second ontology runtime unless a new design explicitly says so
