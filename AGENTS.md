# AGENTS

Project scope: `/root/htops`

## Mission

htops is a business operations kernel for Hetang stores. The preferred architecture path is:

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

## Core Rules

1. Do not expand `src/runtime.ts` with new business entry responsibilities.
2. Prefer owner modules over compatibility facades:
   - intent: `src/query-intent.ts`
   - plan: `src/query-plan.ts`
   - capability graph: `src/capability-graph.ts`
   - serving execution: `src/sql-compiler.ts`, `src/query-engine.ts`
   - serving publication: `src/store/serving-publication-store.ts`
3. New query/report work should extend the capability graph first, not add ad-hoc routing.
4. New behavior should land with tests first when practical.
5. Approved designs and implementation plans belong in `docs/plans/`.

## Repo Workflow Pack

Use the repo-local OMX-style workflow layer:

- clarify: `.omx/commands/deep-interview.md`
- plan: `.omx/commands/ralplan.md`
- execute: `.omx/commands/ralph.md`
- parallel split: `.omx/commands/team.md`

## Verification

Before claiming completion:

- run the targeted test command
- run the relevant repo doctor/bootstrap command if infrastructure changed
- state exact commands that were executed

## Operations Notes

- bridge service: `htops-bridge.service`
- scheduled worker: `htops-scheduled-worker.service`
- analysis worker: `htops-analysis-worker.service`
- query api: `htops-query-api.service`
