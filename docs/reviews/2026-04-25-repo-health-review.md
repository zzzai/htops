# Repo Health Review

Date: 2026-04-25
Scope: production files under `src/` plus directly relevant tests, owner-module docs, and approved architecture plans

## Reviewed Scope

- Production files reviewed structurally: 189 TypeScript files under `src/` excluding `*.test.ts`
- Deep manual review focus:
  - `src/runtime.ts`
  - `src/store.ts`
  - `src/query-intent.ts`
  - `src/query-plan.ts`
  - `src/capability-graph.ts`
  - `src/query-engine.ts`
  - `src/sql-compiler.ts`
  - `src/app/admin-read-service.ts`
  - `src/app/reporting-service.ts`
  - `src/app/query-read-service.ts`
  - `src/app/analysis-service.ts`
  - `src/store/conversation-semantic-state-store.ts`
  - `src/store/semantic-execution-audit-store.ts`
  - `src/store/serving-publication-store.ts`

## Business Insight

The repo still has a strong semantic-query spine:

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

The main risk is not query semantics quality. The main risk is control-plane drift: `runtime.ts` and `store.ts` keep absorbing responsibilities that should belong to owner modules. That drift is now large enough to weaken type safety, owner clarity, and safe change velocity.

## Findings

### 1. High: current workspace does not type-check because `src/store.ts` pushes a string array into a `Array<string | number>`

Evidence:

- `src/store.ts:6975-6987`
- `npx tsc -p tsconfig.json --noEmit`

Details:

- `values` is declared as `Array<string | number>`.
- `params.signalKinds` is `HetangIndustryContextSignalKind[]`.
- `values.push(params.signalKinds!)` violates the declared element type and currently breaks the build.

Impact:

- This is a hard build regression in the current workspace.
- It also hides the SQL contract because `ANY($n)` is being fed an array without an explicit typed parameter contract.

Recommended action:

- Change `values` to a type that can carry array parameters cleanly, for example `unknown[]`.
- Add an explicit SQL cast such as `signal_kind = ANY($n::text[])`.

### 2. High: `src/runtime.ts` has become the god facade that repo rules explicitly try to prevent

Evidence:

- `src/runtime.ts:417-646`
- `src/runtime.ts:1088-1433`
- `AGENTS.md`
- `docs/prompts/project-architecture-rules.md`

Details:

- `HetangOpsRuntime` now constructs most services itself, wires cross-service closures, and exposes a very large menu of business entry methods.
- It is no longer a thin runtime shell. It is a full application facade for query, reporting, sync, delivery, admin-read, analysis, semantic fallback, and audit.
- `queryRuntime: this as never` at `src/runtime.ts:568-572` is a concrete sign that type boundaries are already being forced open to keep this shape working.

Impact:

- Any new business path is incentivized to land in `runtime.ts`, which conflicts with the repo rule "Do not expand `src/runtime.ts` with new business entry responsibilities."
- Testing and ownership become indirect because callers depend on the runtime facade instead of the owner service.

Recommended action:

- Freeze new business methods on `HetangOpsRuntime`.
- Make callers depend on owner services directly where possible.
- Move runtime responsibilities toward bootstrapping and lifecycle only.

### 3. High: `src/store.ts` is still the accidental owner, and sub-store boundaries are being bypassed by casts instead of real contracts

Evidence:

- `src/store.ts:1347-1349`
- `src/store.ts:1365-1373`
- `src/app/admin-read-service.ts:344-408`
- `src/app/reporting-service.ts:305-341`
- `src/app/analysis-service.ts:430-438`
- `src/app/query-read-service.ts:143-149`

Details:

- `HetangOpsStore` constructs sub-stores by passing `this as unknown as any`.
- Multiple services then probe optional getters and fall back to the entire `HetangOpsStore` when the getter is absent.
- This is not a stable owner-module contract. It is a compatibility mesh that keeps the monolith as the true dependency surface.

Impact:

- Sub-stores cannot enforce clean interfaces because they are effectively wrappers around the same giant object.
- Type safety is weakened both at construction time and at consumption time.
- The repo rule "Prefer owner modules over compatibility facades" is being violated in practice.

Recommended action:

- Introduce explicit interfaces for each owner store surface.
- Construct sub-stores from those interfaces, not from `HetangOpsStore` itself.
- Remove "if getter exists else use the whole store" patterns from services.

### 4. Medium: conversation semantic state writes anchor history that is never read and never cleaned

Evidence:

- `src/app/conversation-semantic-state-service.ts:269-277`
- `src/store/conversation-semantic-state-store.ts:95-110`
- `src/store/conversation-semantic-state-store.ts:216-251`
- repo-wide search shows only write sites for `conversation_anchor_facts`, no read path
- approved design expected the service to read anchored state: `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md:138-140`

Details:

- The service appends `conversation_anchor_facts` on every qualifying turn.
- The store exposes append and state cleanup, but no read API for anchor facts.
- Expired session state is deleted; anchor facts are not.

Impact:

- The table currently adds write amplification and storage growth without powering any behavior.
- This is a bounded-feature design that has already drifted into dead control-plane data.

Recommended action:

- Either wire anchor-fact reads into the state-resolution path immediately, or delete the table and writes until a real reader exists.
- If the table stays, add expiry/retention cleanup.

### 5. Medium: the implemented semantic-state and semantic-audit schemas diverge from approved design by storing time fields as `TEXT`

Evidence:

- `src/store/conversation-semantic-state-store.ts:71-110`
- `src/store/semantic-execution-audit-store.ts:53-80`
- approved semantic-state design uses `timestamptz`: `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md:181-225`
- approved quality-loop design uses `timestamptz`: `docs/plans/2026-04-17-semantic-quality-loop-design.md:113-130`

Details:

- `updated_at`, `expires_at`, `valid_from`, `valid_to`, `created_at`, and `occurred_at` are all stored as `TEXT`.
- Current code relies on ISO-string lexical ordering to filter and sort.

Impact:

- Queries are more fragile than necessary.
- Schema no longer matches approved design.
- Time-window correctness now depends on string normalization rather than database time semantics.

Recommended action:

- Migrate these columns to `timestamptz`.
- Keep JSON payloads as JSONB, but move temporal fields back to typed columns.

### 6. Medium: analytics-view rebuild paths can change serving data without changing serving version, so query cache invalidation becomes ambiguous

Evidence:

- `src/store.ts:3841-3849`
- `src/store.ts:3854-3866`
- `src/store.ts:3899-3908`
- `src/runtime/runtime-shell.ts:25-50`
- `src/sql-compiler.ts:57-63`
- `src/app/sync-service.ts:1909-1918`

Details:

- `ensureAnalyticsViewsReady()` and `forceRebuildAnalyticsViews()` rebuild or refresh serving views.
- Those paths do not publish a new serving manifest.
- The runtime shell caches compiled-serving query rows by `cacheKey`, and the cache key is versioned by `servingVersion`.

Impact:

- If serving data changes via repair/rebuild without a manifest update, in-process cached rows can survive under the old serving version until TTL expiry.
- Operators also lose a clean observability edge between "views rebuilt" and "new serving version published".

Recommended action:

- Treat any rebuild/refresh that changes serving data as a publication event.
- Publish or bump serving version in rebuild paths, not only in explicit nightly publish flows.

### 7. Low: several tests require binding `127.0.0.1`, so repo verification is not portable to restricted sandboxes

Evidence:

- `src/bridge/server.test.ts:19-25`
- `src/tools/server.test.ts:339-345`
- `src/app/analysis-local-sidecar.test.ts:295-324`
- observed failure: `listen EPERM: operation not permitted 127.0.0.1`

Details:

- These tests open local HTTP servers directly.
- In restricted environments, they fail or time out even when product code is fine.

Impact:

- "repo green" cannot currently be reproduced in sandboxed execution environments.
- This creates noisy review signals and weakens automated verification.

Recommended action:

- Mark these as integration tests with environment guards, or replace localhost sockets with injectible transport mocks where practical.

## File Notes

### Strong / no material blockers found in core semantic query chain

- `src/query-intent.ts`
- `src/query-plan.ts`
- `src/capability-graph.ts`
- `src/query-entry-adapter.ts`
- `src/query-engine.ts`
- `src/query-engine-executor.ts`
- `src/sql-compiler.ts`

Reason:

- Query-path targeted tests passed.
- Architecture intent is still coherent here: semantic intent -> plan -> capability selection -> safe execution remains recognizable.

### Main owner-boundary pressure points

- `src/runtime.ts`
- `src/store.ts`
- `src/app/admin-read-service.ts`
- `src/app/reporting-service.ts`
- `src/app/query-read-service.ts`
- `src/app/analysis-service.ts`
- `src/app/sync-service.ts`

Reason:

- These files carry most of the boundary leakage, compatibility casting, and "whole store as fallback interface" behavior.

### Newly added semantic control-plane files need tightening, not expansion

- `src/app/conversation-semantic-state-service.ts`
- `src/store/conversation-semantic-state-store.ts`
- `src/app/semantic-quality-service.ts`
- `src/store/semantic-execution-audit-store.ts`

Reason:

- Direction is approved and useful.
- Implementation still needs to become stricter and smaller: typed timestamps, real readers for anchor history, and no dead control-plane tables.

## Recommended Remediation Order

1. Fix the build break in `src/store.ts`.
2. Stop adding new business entry methods to `src/runtime.ts`.
3. Replace whole-store fallback casts with explicit owner-store interfaces.
4. Either activate or remove `conversation_anchor_facts`.
5. Migrate semantic-state and semantic-audit timestamps from `TEXT` to `timestamptz`.
6. Make serving-view rebuilds publish a new serving manifest/version.
7. Reclassify localhost-binding tests as integration-only or make them transport-mockable.

## Verification Commands Executed

- `npx tsc -p tsconfig.json --noEmit`
- `npm test`
- `npx vitest run src/bridge/server.test.ts`
- `npx vitest run src/tools/server.test.ts`
- `npx vitest run src/**/*.test.ts --exclude src/bridge/server.test.ts --exclude src/tools/server.test.ts`
- `npx vitest run src/store/semantic-execution-audit-store.test.ts`
- `npx vitest run src/app/conversation-semantic-state-service.test.ts`
- `npx vitest run src/query-engine.test.ts src/query-engine-semantic-quality.test.ts src/query-entry-adapter.test.ts src/query-plan.test.ts src/query-intent.test.ts`

## Verification Notes

- `tsc` failed with the `src/store.ts` array-typing error above.
- Targeted semantic query tests passed.
- HTTP-server tests failed in this environment because localhost listen is blocked by sandbox policy, not because assertions disagreed with product behavior.
