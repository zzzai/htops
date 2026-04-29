# Hetang Runtime / Store Facade Slimming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Thin the runtime facade, split the hottest store responsibilities, and make analytics publication explicit and batch-oriented.

**Architecture:** Keep `HetangOpsRuntime` and `HetangOpsStore` as compatibility facades while moving reporting, analysis, and admin/read orchestration into `src/app/` owner services. Introduce owner stores for raw ingestion, serving publication, and queue/access/control concerns, then route the nightly sync path to batch analytics publication instead of write-time refreshes.

**Tech Stack:** TypeScript, Vitest, PostgreSQL, existing Hetang runtime/store/query modules.

---

### Task 1: Lock batch publication behavior with tests

**Files:**
- Modify: `src/sync.test.ts`
- Modify: `src/store.test.ts`

**Steps**

1. Add a failing sync test proving nightly sync passes `refreshViews: false` for analytics writes and performs one publication step after the batch.
2. Add a failing store test proving publication can be requested explicitly after deferred writes.
3. Run:

```bash
pnpm exec vitest run src/sync.test.ts src/store.test.ts
```

4. Make the minimal production changes until both tests pass.

### Task 2: Extract serving publication ownership

**Files:**
- Create: `src/store/serving-publication-store.ts`
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

**Steps**

1. Move analytics refresh / rebuild and serving manifest/query helpers into the serving owner store.
2. Keep `HetangOpsStore` methods as delegating compatibility methods.
3. Verify with:

```bash
pnpm exec vitest run src/store.test.ts -t "serving"
```

### Task 3: Extract raw-ingestion ownership

**Files:**
- Create: `src/store/raw-ingestion-store.ts`
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

**Steps**

1. Move sync runs, raw batches / rows, sync errors, and endpoint watermarks behind the raw-ingestion owner store.
2. Keep `HetangOpsStore` API unchanged.
3. Verify with:

```bash
pnpm exec vitest run src/store.test.ts -t "raw|watermark|sync"
```

### Task 4: Extract queue/access/control ownership

**Files:**
- Create: `src/store/queue-access-control-store.ts`
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

**Steps**

1. Move scheduled job state, bindings, command audit, action items, and control tower helpers into the owner store.
2. Keep analysis queue behavior intact.
3. Verify with:

```bash
pnpm exec vitest run src/store.test.ts -t "binding|audit|action|control"
```

### Task 5: Extract reporting, analysis, and admin/read services

**Files:**
- Create: `src/app/reporting-service.ts`
- Create: `src/app/analysis-service.ts`
- Create: `src/app/admin-read-service.ts`
- Modify: `src/runtime.ts`
- Modify: `src/runtime.test.ts`

**Steps**

1. Add failing runtime tests that lock delegation for reporting, analysis, and admin/read methods.
2. Move method bodies into owner services.
3. Keep `HetangOpsRuntime` public methods as delegation shims.
4. Verify with:

```bash
pnpm exec vitest run src/runtime.test.ts
```

### Task 6: Run focused regression verification

**Files:**
- Modify if needed: `src/sync.ts`, `src/runtime.ts`, `src/store.ts`

**Steps**

1. Run the targeted suites:

```bash
pnpm exec vitest run src/store.test.ts src/sync.test.ts src/runtime.test.ts src/service.test.ts
```

2. Fix any regressions introduced by the refactor.
3. Summarize residual risk, especially around sync-service extraction that remains for a later pass.
