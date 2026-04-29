# Hetang Reactivation Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an inferred stored-value trajectory feature table for member-level reactivation modeling and use it to improve Yingbin store reactivation prioritization without changing existing customer segment definitions.

**Architecture:** Add a new derived mart table keyed by `org_id + biz_date + member_id`, compute it from existing member snapshots, consume bills, recharge bills, and customer segment rows, then join it at reactivation ranking time as an additive scoring layer. Keep `mart_customer_segments` and existing segment labels unchanged.

**Tech Stack:** Node.js, TypeScript, PostgreSQL, pg-mem, Vitest

---

### Task 1: Add the failing tests

**Files:**
- Modify: `src/reactivation-push.test.ts`
- Modify: `src/store.test.ts`
- Create: `src/reactivation-features.test.ts`

**Step 1: Write the failing feature-builder tests**

Add tests that prove:
- the inferred feature builder computes stored balance deltas and recharge/member-pay windows from existing facts
- the reactivation score rises for members with strong stored balance and recent depletion risk

**Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/reactivation-features.test.ts src/reactivation-push.test.ts src/store.test.ts`

Expected: failures for missing types, missing builder, missing store methods, and missing feature-aware ranking behavior

### Task 2: Add feature schema and persistence

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

**Step 1: Add a new feature record type**

Define a member-level reactivation feature row that includes:
- snapshot balance anchors
- inferred balance deltas
- recharge windows
- depletion velocity
- projected balance days left
- confidence score
- reactivation priority score

**Step 2: Add the new mart table and store methods**

Add:
- `mart_member_reactivation_features_daily`
- replace/list methods for a single day and date range

**Step 3: Run focused tests**

Run: `pnpm exec vitest run src/store.test.ts`

Expected: new persistence tests pass

### Task 3: Build inferred reactivation features

**Files:**
- Create: `src/reactivation-features.ts`
- Modify: `src/reactivation-features.test.ts`

**Step 1: Implement the builder**

Build daily member features from:
- member daily snapshots
- customer segments
- recharge bills

Keep the first version narrow and deterministic.

**Step 2: Add range rebuild helper**

Expose a date-range rebuild function that writes the derived rows through the store.

**Step 3: Run focused tests**

Run: `pnpm exec vitest run src/reactivation-features.test.ts`

Expected: builder and rebuild tests pass

### Task 4: Integrate into reactivation ranking

**Files:**
- Modify: `src/reactivation-push.ts`
- Modify: `src/runtime.ts`
- Modify: `src/reactivation-push.test.ts`

**Step 1: Load features alongside latest segment snapshot**

Keep the current snapshot lookup behavior but allow optional feature rows for the same business date.

**Step 2: Update ranking**

Use the inferred feature score as an additive signal while preserving current bucket logic and current labels.

**Step 3: Rebuild features in the historical catchup path**

After member snapshots and customer intelligence are rebuilt, rebuild the feature table in the same date range.

**Step 4: Run focused tests**

Run: `pnpm exec vitest run src/reactivation-push.test.ts src/runtime.test.ts src/reactivation-features.test.ts`

Expected: ranking and rebuild integration tests pass

### Task 5: Verify the whole slice

**Files:**
- Modify only if verification reveals an issue

**Step 1: Run the regression slice**

Run: `pnpm exec vitest run src/reactivation-features.test.ts src/reactivation-push.test.ts src/runtime.test.ts src/store.test.ts src/customer-history-backfill.test.ts src/customer-intelligence.test.ts`

Expected: targeted slice passes

**Step 2: Summarize remaining risks**

Document that:
- existing segment labels remain unchanged
- ranking improves only when feature rows exist
- inferred balance features are suitable for reactivation modeling, not ledger-grade reconciliation
