# Hetang Serving Query Plan P0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a production-ready P0 query plane based on `QueryPlan + Capability Registry + SQL Compiler`, backed by first-party `serving_*` surfaces, while keeping the current Hetang query engine as a safe fallback.

**Architecture:** Keep PostgreSQL as the single warehouse and serving store. Add typed `serving_*` views/tables plus a lightweight `serving_manifest`, then route selected high-value queries through a new deterministic query plane before falling back to the existing query-engine branches. Query understanding stays rule-first with optional AI fallback, but production SQL is always compiled from registered capabilities.

**Tech Stack:** TypeScript, PostgreSQL, Vitest, pg-mem, existing Hetang runtime/store/query layers.

---

### Task 1: Define the new query-plane contracts

**Files:**
- Create: `src/query-plan.ts`
- Create: `src/capability-registry.ts`
- Create: `src/sql-compiler.ts`
- Test: `src/query-plan.test.ts`
- Test: `src/sql-compiler.test.ts`

**Step 1:** Write failing tests for `QueryPlan` normalization and capability matching.

**Step 2:** Run the new focused tests and verify they fail because the modules do not exist yet.

**Step 3:** Add minimal `QueryPlan`, capability, and SQL compiler contracts.

**Step 4:** Re-run the focused tests until they pass.

### Task 2: Add first-party serving surfaces and manifest storage

**Files:**
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

**Step 1:** Add a `serving_manifest` table and read/write helpers.

**Step 2:** Create the first serving surfaces:
- `serving_store_day`
- `serving_store_window`
- `serving_customer_profile_asof`
- `serving_customer_ranked_list_asof`
- `serving_tech_profile_window`
- `serving_hq_portfolio_window`

**Step 3:** Add a store method that executes compiled serving SQL safely and returns rows.

**Step 4:** Add tests proving the serving surfaces are created and the manifest is readable.

### Task 3: Expose the serving query plane through runtime

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/runtime.test.ts`

**Step 1:** Add runtime methods for:
- current serving version
- executing compiled serving queries
- optional in-process compiled-query caching

**Step 2:** Add tests proving the runtime proxies these calls to the store.

### Task 4: Route selected high-value queries through the new query plane

**Files:**
- Modify: `src/query-engine.ts`
- Modify: `src/query-engine.test.ts`

**Step 1:** Write failing tests showing that:
- store summary questions prefer the new serving query plane
- HQ ranking questions prefer the new serving query plane
- customer profile questions can prefer the new serving query plane
- unsupported plans still fall back to the legacy handlers

**Step 2:** Add a planner bridge from current intent output to `QueryPlan`.

**Step 3:** Add capability lookup and SQL compilation.

**Step 4:** Add safe fallback to the existing branches when a plan cannot be served yet.

**Step 5:** Re-run the focused query-engine tests until green.

### Task 5: Verify no regressions in current Hetang behavior

**Files:**
- Verify only

**Step 1:** Run the new focused suites:

```bash
pnpm exec vitest run src/query-plan.test.ts src/sql-compiler.test.ts src/store.test.ts src/runtime.test.ts src/query-engine.test.ts
```

**Step 2:** Run the full TypeScript suite:

```bash
pnpm exec vitest run
```

**Step 3:** Run the Python query API smoke tests:

```bash
api/.venv/bin/python -m unittest api/test_main.py
```
