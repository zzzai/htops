# 2026-04-26 Technical And Business Architecture Review

## Review Scope

This review re-checks the current htops architecture against the repo mission:

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

It also checks whether the approved Ontos-lite evolution path is still bounded:

`Capability Graph -> Conversation Semantic State -> Semantic Execution Audit / Quality Loop`

The review is based on current workspace code and the prior reviews from 2026-04-22 and 2026-04-25.

## Business Insight

The product is no longer just a reporting bot. The current business architecture is a store operations kernel with four visible loops:

1. Deterministic store facts and reports: daily reports, weekly reports, five-store overview, HQ ranking, and serving read models.
2. Store execution control plane: scheduled jobs, sync orchestration, report generation, delivery, audit state, and readiness summaries.
3. Customer growth loop: customer operating profiles, segmentation, reactivation push, and outcome feedback.
4. Semantic quality loop: capability graph selection, conversation semantic state, semantic execution audit, and bounded AI lanes.

This is directionally aligned with the mission. The highest-value business next step is not adding another report. It is making the HQ decision surface explicit: the boss should see one deterministic "what changed, why it matters, what to do next" surface that composes report readiness, store ranking, customer opportunities, industry weak signals, and audit confidence.

## Current State Since The Last Reviews

The architecture has improved materially since the 2026-04-22 architecture review and 2026-04-25 repo health review.

Positive changes observed:

1. Daily report correctness is now part of the control plane. `auditDailyReportWindow` checks active stores over a rolling window and records mismatch, missing, and unaudited-key status (`src/daily-report-window-audit.ts:23`).
2. Industry context has a minimal owner module and explicit weak-signal truth boundary. `IndustryContextModule` is bounded to `hq_narrative`, `world_model`, and `store_diagnosis` (`src/industry-context.ts:4`), and snapshots become world-model observations with `truthBoundary: "weak_signal"` (`src/industry-context.ts:52`).
3. Weekly HQ reporting can now consume industry observations instead of treating industry context as a separate narrative island (`src/app/reporting-service.ts:522`).
4. Serving publication is no longer invisible after view rebuild/refresh. Rebuild paths publish a generated serving manifest (`src/store.ts:3860`).
5. AI usage is bounded by a lane registry. Active lanes and reserved future lanes are explicit, which keeps probabilistic work away from deterministic serving paths (`src/ai-lanes/registry.ts:4`, `src/ai-lanes/registry.ts:13`).
6. HQ capability graph coverage exists for portfolio async review, portfolio overview, and serving-backed HQ window ranking (`src/capability-graph.ts:332`, `src/capability-graph.ts:348`, `src/capability-graph.ts:464`).

Net: the project is moving toward a coherent business operations kernel, not a pile of scripts.

## Findings

### P0 - `runtime.ts` Still Has God-Facade Pressure

`src/runtime.ts` still wires too many business actions directly into `HetangSyncOrchestrator` (`src/runtime.ts:523`). The runtime currently passes closures for sync, backfill, serving publication, customer catchup, conversation review, environment memory, report build, report send, external brief, midday brief, reactivation push, weekly chart, and notification delivery.

The strongest smell remains `queryRuntime: this as never` when constructing `HetangAnalysisExecutionService` (`src/runtime.ts:581`). This defeats TypeScript as an architecture boundary and makes the runtime the implicit owner of analysis query capabilities.

Impact:

1. New business entry responsibilities are still tempted to land in runtime, violating the repo rule.
2. Service ownership is harder to reason about because runtime is both composition root and business facade.
3. Testing can pass while architecture drifts because casts hide missing ports.

Recommendation:

1. Freeze new business methods on `runtime.ts`.
2. Define a narrow `AnalysisQueryRuntimePort` instead of `this as never`.
3. Move job-specific dependency bundles into owner modules or small ports, keeping runtime as composition root only.

### P0 - `store.ts` Is Improved But Still An Accidental Owner

`src/store.ts` now exposes explicit sub-store getters, which is good. But the constructor still builds owner stores by casting the root store into each sub-store's constructor shape (`src/store.ts:1356`, `src/store.ts:1359`, `src/store.ts:1362`).

Impact:

1. The root store remains the dependency graph.
2. Sub-store ownership is less enforceable because constructor contracts are bypassed through casts.
3. Future store split work will be harder because owner stores still depend on the entire root shape.

Recommendation:

1. Keep the getters, but replace root-store casts with explicit dependency objects.
2. Make new services require owner stores directly, for example `getRawIngestionStore()` or `getServingPublicationStore()`, not the entire root store.
3. Add tests that fail when required owner-store ports are missing.

### P1 - Query Rendering Contract Has Active Drift

The current targeted test suite has one failure in `src/query-engine-modules.test.ts:1217`.

Expected:

`2026-04-15：加钟明细待补齐，暂不输出当日加钟数量/加钟率`

Observed from the test run:

`2026-04-15：加钟率 明细待补齐，暂不输出当日分天口径`

Impact:

1. The deterministic query layer and test contract disagree on how incomplete daily KPI clock breakdowns should be communicated.
2. This is small in code size but important in product trust: users ask whether every daily metric is calculated correctly, so incomplete-source wording must be stable and precise.
3. It also shows why report/query wording is part of the serving contract, not just presentation.

Recommendation:

1. Decide the canonical incomplete-clock-breakdown wording.
2. Fix the implementation or the test, not both blindly.
3. Add one focused regression that distinguishes "metric unavailable" from "day excluded from closed-day aggregate".

### P1 - Industry Context Exists But Is Not Yet A First-Class HQ Capability

The new industry context module is correctly bounded and uses weak-signal semantics. However, it is currently consumed as a supplement to world-model/weekly reporting rather than as a capability graph surface.

Impact:

1. Boss-facing HQ questions cannot reliably ask "行业变化对五店意味着什么" through the same semantic path as store metrics.
2. External intelligence, industry context snapshots, HQ narrative, and world model can still drift unless there is a promotion contract.
3. The business value is visible but not yet fully operationalized.

Recommendation:

1. Add capability graph nodes for bounded HQ industry-context reads.
2. Treat industry context as weak evidence attached to deterministic HQ facts, not as a standalone answer source.
3. Define a promotion flow from external brief/card evidence into `industry_context_snapshots`.

### P1 - World Model Is A Useful Derived State, Not Yet A Production Decision Runtime

The world model assembles customer, store, market, and industry state with explicit truth boundaries (`src/world-model/state.ts:159`). This is the right Ontos-lite shape. It should not be promoted into a second ontology runtime.

Impact:

1. The model is valuable as a derived snapshot and explanation substrate.
2. It is not yet the authoritative HQ read surface.
3. Promoting it too early would recreate the full-ontology risk the repo rules explicitly reject.

Recommendation:

1. Keep world model as a derived evidence snapshot.
2. Only use it in production answers when each state segment carries source, freshness, and truth-boundary metadata.
3. Let capability graph and serving read models remain the primary execution path.

### P2 - External Intelligence And Industry Context Need A Lifecycle Contract

External brief types and industry context snapshot types both exist, but the lifecycle from "external event/card" to "business-approved industry signal" is not yet explicit.

Impact:

1. The same outside-world fact can be summarized in briefs while not appearing in industry snapshots.
2. HQ weekly reports can miss signals that operations staff already saw in external intelligence.
3. Without promotion rules, weak signals become manually curated fragments.

Recommendation:

1. Add an explicit promotion record or job from external brief items to industry context candidates.
2. Keep human or deterministic validation before signals become HQ report evidence.
3. Track `source_uri`, confidence, applicable modules, freshness, and dismissal state.

## Option Comparison

### Option A - Tighten The Current Modular Monolith

Keep PostgreSQL, owner modules, capability graph, serving read models, and bounded AI lanes. Refactor the runtime/store boundaries without changing the product shape.

This is the recommended path. It preserves delivery speed and directly resolves the current architecture risks.

### Option B - Build A Larger Ontology Or World-Model Runtime

This would make the architecture look cleaner on paper but violates the repo's Ontos-lite constraint. The current product does not need a second ontology runtime.

Reject for now.

### Option C - Continue As A Report/Query/Push Feature Mesh

This is the default drift path: every new need becomes a new service, report, or scheduled job. It would move fast short term but fragment the business architecture.

Reject as the main direction.

## Core Data Model Assessment

PostgreSQL remains the correct operational truth source.

Current data model layers:

1. Internal hard facts: raw ingestion, mart metrics, daily store metrics, daily reports, customer operating profiles, reactivation outcomes.
2. Serving read layer: analytics views, serving publication manifest, HQ/store query surfaces.
3. Control plane: scheduled job state, report readiness, daily report audit, semantic execution audit, conversation semantic state.
4. External and weak-signal layer: external context entries, external briefs, industry context snapshots.
5. Derived intelligence: operating world state snapshots and report narratives.

The boundary is mostly correct: hard facts and serving views answer deterministic questions; weak signals enrich HQ narrative and diagnosis; AI lanes summarize or analyze but should not become truth.

## Boundary Assessment

Healthy boundaries:

1. Capability graph is the semantic entry point for query/report expansion.
2. Serving SQL and query engine remain the deterministic answer path.
3. AI lane registry bounds probabilistic execution.
4. Daily report audit adds measurable report correctness control.
5. Industry context is explicitly weak-signal evidence.

Weak boundaries:

1. `runtime.ts` remains a business facade instead of only a composition root.
2. `store.ts` still owns too much dependency construction through casts.
3. HQ decision surface is not yet unified even though the ingredients exist.
4. Industry context is not yet a first-class capability.
5. Query fallback wording is not fully contract-stable.

## Phased Corrective Actions

### Phase 0 - Restore Deterministic Query Contract

Fix the failing `query-engine owner modules` test around incomplete daily KPI clock breakdown wording. This is the most immediate quality risk because it directly affects user trust in daily metrics.

### Phase 1 - Stop Boundary Drift

Freeze new business entry responsibilities in `runtime.ts`. Replace `queryRuntime: this as never` with a narrow explicit port. Replace root-store constructor casts with explicit owner-store dependency objects.

### Phase 2 - Promote HQ Decision Surface

Make HQ overview the first-class business surface. It should combine:

1. Five-store operating summary.
2. Daily report audit confidence.
3. Store ranking and risk movement.
4. Customer growth opportunities.
5. Industry weak signals with confidence and freshness.
6. Recommended action queue.

### Phase 3 - Connect External Intelligence To Industry Context

Define the lifecycle from external brief item to industry context candidate to approved snapshot. This avoids parallel narrative systems.

### Phase 4 - Use World Model Only After Evidence Contracts Are Stable

Keep the world model as a derived snapshot until source metadata, freshness, and truth boundaries are consistently attached across HQ reads.

## Verification

Commands run during this review:

```bash
npx vitest run src/industry-context.test.ts src/daily-report-window-audit.test.ts src/store/conversation-semantic-state-store.test.ts src/store/semantic-execution-audit-store.test.ts src/app/sync-service.test.ts src/app/admin-read-service.test.ts src/query-entry-adapter.test.ts src/capability-graph.test.ts src/query-engine-modules.test.ts
```

Result: 8 test files passed; `src/query-engine-modules.test.ts` failed 1 test. Total observed result: 111 passed, 1 failed.

```bash
npx tsc -p tsconfig.json --noEmit
```

Result: passed with exit code 0.

This review therefore does not claim the targeted test suite is clean. The architecture status is: TypeScript compiles, but one deterministic query rendering contract needs correction before the suite can be treated as green.
