# Hetang Nightly Backfill Acceleration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the nightly `03:00` Hetang job coverage-aware so it stops replaying already-complete historical ranges, and make customer history catchup rebuild only the stores that still lag derived customer layers.

**Architecture:** Add coverage summary helpers in `store.ts`, then let `runtime.ts` build dynamic raw-fact backfill plans from PostgreSQL coverage instead of stale `scheduled_job_state`. Keep API time focused on missing raw facts and move customer-layer recovery to local rebuilds over existing facts.

**Tech Stack:** TypeScript, Vitest, pg-mem, PostgreSQL materialized views, Hetang runtime/store layers

---

### Task 1: Lock the coverage-aware nightly plan with tests

**Files:**
- Modify: `extensions/hetang-ops/src/runtime.test.ts`

**Step 1: Write the failing test**

Add a test proving that when consume/recharge/tech-up-clock already span the full historical window, nightly backfill only requests the missing raw endpoints and skips `1.1`, `1.5`, and `1.8`.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "plans coverage-aware nightly backfill from raw fact gaps"`

Expected: FAIL because runtime still uses stale state-based weekly replay.

**Step 3: Write minimal implementation**

Add coverage-aware planning helpers in `runtime.ts` and use a mocked store coverage helper in the test.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "plans coverage-aware nightly backfill from raw fact gaps"`

Expected: PASS

### Task 2: Lock the coverage-aware customer catchup with tests

**Files:**
- Modify: `extensions/hetang-ops/src/runtime.test.ts`

**Step 1: Write the failing test**

Add a test proving that `runCustomerHistoryCatchup` skips fully covered stores and only rebuilds the stores whose customer-derived layers still lag.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "rebuilds customer history only for stores whose derived coverage still lags"`

Expected: FAIL because runtime currently rebuilds every active store once the job is due.

**Step 3: Write minimal implementation**

Teach runtime to read derived-layer coverage from store and build a coverage-aware local rebuild plan.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "rebuilds customer history only for stores whose derived coverage still lags"`

Expected: PASS

### Task 3: Add coverage summary helpers in the store layer

**Files:**
- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts`
- Modify: `extensions/hetang-ops/src/types.ts`

**Step 1: Write the failing test**

Add a pg-mem store test that seeds raw facts and customer-derived tables and asserts a typed coverage summary comes back with the right `rowCount`, `dayCount`, `minBizDate`, and `maxBizDate`.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts -t "summarizes historical raw and derived coverage for a store"`

Expected: FAIL because no coverage helper exists yet.

**Step 3: Write minimal implementation**

Implement a single SQL helper in `store.ts` that unions raw and derived coverage summaries for a requested store and date range.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts -t "summarizes historical raw and derived coverage for a store"`

Expected: PASS

### Task 4: Replace the stale nightly planner with a gap-driven planner

**Files:**
- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/types.ts`

**Step 1: Write the failing test**

Extend the nightly runtime test so it asserts:

- only missing endpoints are requested
- fast slices are used when only `1.4` / `1.7` remain
- stores with full raw coverage are skipped

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "plans coverage-aware nightly backfill from raw fact gaps"`

Expected: FAIL

**Step 3: Write minimal implementation**

Add:

- raw-fact coverage classification
- adaptive slice sizing
- dynamic `skipEndpoints`
- old state-based logic as fallback only when coverage helper is unavailable

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "plans coverage-aware nightly backfill from raw fact gaps"`

Expected: PASS

### Task 5: Make customer catchup rebuild only when derived layers lag

**Files:**
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1: Write the failing test**

Extend the customer catchup test so it asserts fully covered stores are reported as already complete and skipped.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "rebuilds customer history only for stores whose derived coverage still lags"`

Expected: FAIL

**Step 3: Write minimal implementation**

Use raw/derived coverage to choose rebuild targets per store and keep the old behavior as fallback if the store helper is unavailable.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "rebuilds customer history only for stores whose derived coverage still lags"`

Expected: PASS

### Task 6: Run targeted verification

**Files:**
- Test: `extensions/hetang-ops/src/runtime.test.ts`
- Test: `extensions/hetang-ops/src/store.test.ts`

**Step 1: Run focused test suite**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/runtime.test.ts extensions/hetang-ops/src/store.test.ts
```

Expected: PASS

**Step 2: Run type/build verification if touched surfaces require it**

Run:

```bash
pnpm build
```

Expected: PASS

**Step 3: Summarize rollout effect**

Document:

- which raw endpoints are now skipped by nightly backfill
- what conditions trigger fast slices
- why customer catchup no longer depends on full API replay
