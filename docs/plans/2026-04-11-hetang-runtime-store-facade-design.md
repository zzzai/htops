# Hetang Runtime / Store Facade Slimming Design

**Goal**

Shrink `src/runtime.ts` into a real compatibility facade, split the hottest `src/store.ts` responsibilities behind owner stores, and stop per-write analytics refreshes from dominating the nightly pipeline.

**Current Problem**

- `src/runtime.ts` still mixes orchestration, reporting, delivery, analysis, admin reads, and runtime bootstrap.
- `src/store.ts` still owns raw ingestion, derived writes, serving publication, queue state, access state, and control settings.
- nightly sync still performs analytics-affecting writes during endpoint waves, which makes view refresh / serving publication semantics too implicit and too expensive.

**Approved Direction**

1. Keep external surfaces stable.
   - `HetangOpsRuntime` remains the public runtime entry.
   - `HetangOpsStore` remains the public store entry.
   - CLI, bridge, query API, workers, and tests continue to call the same top-level types.
2. Move ownership inward.
   - Add owner services under `src/app/` for reporting, analysis, and admin/read responsibilities.
   - Add owner stores for raw ingestion, serving publication, and queue/access/control concerns first, with `HetangOpsStore` delegating to them as a compatibility facade.
3. Make analytics publication explicit.
   - Nightly sync and other batch rebuild flows must write facts / marts with `refreshViews: false`.
   - Publication becomes a single explicit step after a batch finishes.
   - Compatibility refresh methods remain, but the hot path should no longer rely on write-time refresh side effects.

**Target Shape**

- `src/runtime.ts`
  - bootstrap pool/store/client
  - construct owner services
  - keep old public methods as thin delegations
- `src/app/reporting-service.ts`
  - `buildReport`
  - `buildAllReports`
  - `sendReport`
  - `sendMiddayBrief`
  - `sendReactivationPush`
- `src/app/analysis-service.ts`
  - analysis queue operations
  - delivery reply rendering
  - action auto-creation
  - CrewAI / scoped-query execution
- `src/app/admin-read-service.ts`
  - poller persistence and scheduler health
  - queue summaries
  - bindings, audits, control tower, action CRUD
- `src/store/raw-ingestion-store.ts`
  - sync runs
  - raw batches / raw rows
  - sync errors
  - endpoint watermarks
- `src/store/serving-publication-store.ts`
  - analytics refresh / rebuild
  - serving publication
  - compiled serving reads
- `src/store/queue-access-control-store.ts`
  - scheduled job state
  - bindings / command audit
  - control tower
  - action items

**Non-Goals For This Pass**

- full `sync-service` extraction of every nightly helper in one shot
- replacing PostgreSQL or introducing distributed infra
- changing the user-facing command / query contracts

**Verification Focus**

- nightly sync must batch analytics publication instead of refreshing during endpoint writes
- customer-history rebuild must still publish once after a successful batch
- runtime public APIs must preserve behavior while delegating through owner services
