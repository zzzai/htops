# Project Architecture Rules

This file adapts the architecture review role to the `htops` repository.

## Project Identity

`htops` is a business operations kernel for Hetang stores.

Preferred architecture path:

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

## Non-Negotiable Rules

1. Do not expand `src/runtime.ts` with new business entry responsibilities.
2. Prefer owner modules over compatibility facades.
3. New query and report behavior should extend the capability graph first.
4. Keep deterministic control surfaces separate from probabilistic AI behavior.
5. Durable designs and approved plans belong in `docs/plans/`.
6. Function calling may adapt natural language into structured requests, but it must not bypass capability graph, safe execution, or bounded command surfaces.
7. Do not introduce Redis until measured latency or coordination pain proves PostgreSQL plus local caches are insufficient.
8. The approved ontology direction for this repo is **Ontos-lite**:
   - keep `capability graph` as the business semantic truth source
   - add minimal `conversation semantic state` and `semantic quality loop` only when they strengthen the current owner modules
   - do not introduce a second ontology runtime or let ontology abstractions replace capability graph / safe execution

## Current Owner Modules

- intent: `src/query-intent.ts`
- plan: `src/query-plan.ts`
- capability graph: `src/capability-graph.ts`
- serving execution: `src/sql-compiler.ts`, `src/query-engine.ts`
- serving publication: `src/store/serving-publication-store.ts`
- sync execution: `src/app/sync-service.ts`, `src/sync-orchestrator.ts`
- reporting execution: `src/app/reporting-service.ts`
- analysis execution: `src/analysis-orchestrator.ts`

## Preferred System Shape

- single PostgreSQL truth store
- modular monolith over premature microservices
- serving-first daytime query plane
- explicit sync lane and delivery lane
- machine-readable scheduler, queue, and readiness surfaces
- machine-readable contract versions on shared control surfaces
- Ontos-lite semantic evolution:
  - capability graph as L1/L2 business semantics anchor
  - conversation semantic state as minimal L4/L5 context carrier
  - semantic execution audit and doctor summaries as minimal L6 quality loop

## Common Architecture Smells In This Repo

- runtime shell accumulating orchestration logic
- `store.ts` becoming the real owner by accident
- duplicated truth between Node and Python control surfaces
- access decisions spread across message entry, inbound, and query routing
- AI sidecars bypassing durable contracts
- function calling treated as autonomous execution instead of a constrained entry adapter
- Redis proposed before serving/query/coordination evidence exists
- ontology terminology introducing a parallel truth source instead of strengthening capability graph
- semantic-state work drifting into a generic memory platform before production clarify / audit gaps are solved

## Review Questions To Apply

1. Is the source of truth singular and explicit?
2. Is the runtime getting thinner or thicker?
3. Did this change strengthen an owner module or just add another facade hop?
4. Can the operator see scheduler, queue, readiness, and delivery state clearly?
5. Does AI improve analysis without weakening determinism?
6. Does Ontos-lite strengthen semantic state or quality visibility without creating a second business truth source?

## Required Verification Mindset

When making architecture recommendations:

- cite concrete files or docs
- distinguish current state from target state
- prefer bounded migrations over big-bang rewrites
- include verification commands when behavior would change
