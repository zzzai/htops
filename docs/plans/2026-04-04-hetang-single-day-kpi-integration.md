# Hetang Single-Day KPI Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route single-store, single-day business summary questions in `hetang-ops` through `mv_store_manager_daily_kpi` so WeCom users get a faster, cleaner经营复盘回复.

**Architecture:** Keep the current `hetang-ops` inbound and query chain unchanged. Add a narrow matview-backed seam in `store.ts` and `runtime.ts`, then let `query-engine.ts` choose that seam only for single-day report-like queries. Fall back to the existing report builder when KPI rows are unavailable.

**Tech Stack:** TypeScript, Vitest, PostgreSQL materialized view access through the existing `hetang-ops` store/runtime abstractions.

---

### Task 1: Add the failing query-engine tests

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Write the failing test**

- Add a test that asks a single-store, single-day report-style question such as `义乌店昨天经营情况怎么样`.
- Stub `listStoreManagerDailyKpiByDateRange` to return one matview row.
- Assert the reply includes:
  - title with store name and date
  - 实收/耗卡/单数
  - 总上钟/点钟率
  - short insight text
- Assert `buildReport` is not called for this fast path.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "uses daily KPI matview for single-day store report questions"`

Expected: FAIL because the runtime/query path does not support the new KPI method yet.

### Task 2: Add the data seam

**Files:**

- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1: Add a typed row**

- Define a `StoreManagerDailyKpiRow` type in `types.ts`.

**Step 2: Add store access**

- Add `listStoreManagerDailyKpiByDateRange(orgId, startBizDate, endBizDate)` in `store.ts`.
- Read from `mv_store_manager_daily_kpi` by `org_id` and `biz_date BETWEEN ...`.

**Step 3: Add runtime passthrough**

- Expose the same method from `runtime.ts`.

**Step 4: Run focused tests**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "uses daily KPI matview for single-day store report questions"`

Expected: still FAIL until query-engine switches to the new seam.

### Task 3: Switch single-day business summary rendering

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.ts`

**Step 1: Add route selection**

- Detect single-store, single-day, report-like questions such as “经营情况/经营复盘/业绩怎么样”.
- If the runtime supports the KPI matview method, fetch the row and render a compact mobile-friendly summary.

**Step 2: Preserve fallback**

- If no KPI row exists, continue using the existing `buildReport` path.

**Step 3: Run focused tests**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "uses daily KPI matview for single-day store report questions"`

Expected: PASS.

### Task 4: Verify the touched surface

**Files:**

- Modify only if test issues require it.

**Step 1: Run the main scoped suite**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts`

**Step 2: Run adjacent tests if needed**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts`

**Step 3: Summarize outcome**

- Report what now uses the KPI fast path.
- Report what still falls back to daily report aggregation.
