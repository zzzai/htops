# Hetang Composite Store Metrics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three derived management metrics to the existing `hetang-ops` store review chain: stored balance life in months, 30-day renewal pressure index, and stable-member 7-day repurchase rate.

**Architecture:** Keep the current `PostgreSQL + materialized view + query-engine` layout. Extend the existing `mv_store_review_7d` and add a focused 30-day summary surface inside `HetangOpsStore` so the same fields can feed query-engine, HQ async review, and future metric cards without creating a second metric system.

**Tech Stack:** TypeScript, PostgreSQL materialized views, Vitest, pg-mem

---

### Task 1: Lock store-level SQL contracts with failing tests

**Files:**
- Modify: `extensions/hetang-ops/src/store.test.ts`
- Test: `extensions/hetang-ops/src/store.test.ts`

**Step 1: Write the failing store SQL test**

Add assertions to the existing 7-day store review SQL test for:
- `currentStoredBalance`
- `storedBalanceLifeMonths`
- `renewalPressureIndex30d`
- `memberRepurchaseBaseCustomerCount7d`
- `memberRepurchaseReturnedCustomerCount7d`
- `memberRepurchaseRate7d`

Use simple fixture numbers so the expected values are obvious:
- current stored balance = `1200`
- 28-day stored consume = `560`
- stored balance life = `1200 / (560 / 28) / 30 = 2.0 months`
- 30-day renewal pressure = `600 / 400 = 1.5`
- stable-member repurchase = `2 / 4 = 0.5`

**Step 2: Run the test to verify it fails**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/store.test.ts -t "projects 7-day store review rows from a stable SQL surface"
```

Expected: fail because the new fields are not returned yet.

**Step 3: Commit checkpoint intent**

No commit yet. Move straight to implementation once the failure is confirmed.

### Task 2: Extend SQL view, types, and store accessors

**Files:**
- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/types.ts`

**Step 1: Extend the SQL view**

In `mv_store_review_7d`:
- keep the existing 7-day fields
- add rolling 28-day / 30-day inputs from `mart_daily_store_metrics`
- pull `currentStoredBalance` from the last metrics row
- compute:
  - `stored_balance_life_months`
  - `renewal_pressure_index_30d`
  - `member_repurchase_base_customer_count_7d`
  - `member_repurchase_returned_customer_count_7d`
  - `member_repurchase_rate_7d`

Implementation rules:
- `stored_balance_life_months = current_stored_balance / (stored_consume_amount_28d / 28) / 30`
- return `NULL` if the denominator is `<= 0`
- `renewal_pressure_index_30d = stored_consume_amount_30d / recharge_cash_30d`
- stable-member repurchase must come from `mv_customer_profile_90d`, counting only `identity_stable = true`

**Step 2: Extend TypeScript row contracts**

Add matching fields to `StoreReview7dRow` in `extensions/hetang-ops/src/types.ts`.

**Step 3: Extend store row mapping**

Update `listStoreReview7dByDateRange()` so the new SQL columns map into the new TypeScript fields.

**Step 4: Run the focused store test**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/store.test.ts -t "projects 7-day store review rows from a stable SQL surface"
```

Expected: pass.

### Task 3: Surface the new fields through query-engine

**Files:**
- Modify: `extensions/hetang-ops/src/query-engine.ts`
- Modify: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Write failing query-engine coverage**

Add one focused test that feeds a `StoreReview7dRow` with the new fields and expects the summary text to mention:
- `储值寿命`
- `续费压力`
- `会员7日复购率`

Prefer an existing 7-day store-review rendering path instead of a new renderer.

**Step 2: Run the query-engine test to verify it fails**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "surfaces composite store metrics in 7-day review output"
```

Expected: fail because the text does not include the new fields yet.

**Step 3: Implement the minimal query text**

Update the 7-day review / HQ summary wording so the new fields appear only when present and are phrased as management signals, not raw tool output.

**Step 4: Run the focused query-engine test**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "surfaces composite store metrics in 7-day review output"
```

Expected: pass.

### Task 4: Run integration verification

**Files:**
- No code changes expected

**Step 1: Run targeted Hetang test lanes**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/store.test.ts extensions/hetang-ops/src/query-engine.test.ts
```

Expected: pass.

**Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: pass.

**Step 3: Commit**

Use:

```bash
scripts/committer "Hetang: add composite store review metrics" docs/plans/2026-04-05-hetang-composite-store-metrics.md extensions/hetang-ops/src/store.test.ts extensions/hetang-ops/src/store.ts extensions/hetang-ops/src/types.ts extensions/hetang-ops/src/query-engine.ts extensions/hetang-ops/src/query-engine.test.ts
```
