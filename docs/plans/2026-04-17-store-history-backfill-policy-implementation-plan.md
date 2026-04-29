# Store History Backfill Policy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make nightly history backfill honor a store-specific policy: Yingbin keeps full-history recovery, while the other four production stores only require complete coverage from 2025-10-06 onward.

**Architecture:** Keep the behavior inside `HetangSyncService`. Add one small policy resolver used by the coverage-aware planner, and cover it with focused service-level regression tests. Do not expand `runtime.ts` or add new config surfaces.

**Tech Stack:** TypeScript, Vitest, existing Hetang sync/backfill planner

---

### Task 1: Add failing planner tests

**Files:**
- Modify: `src/app/sync-service.test.ts`

**Step 1: Write the failing tests**

Add:

- one test proving a non-Yingbin production store starts backfill planning at `2025-10-06`
- one test proving Yingbin falls back from the recent window to the full-history window

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/sync-service.test.ts -t "uses the shared 2025-10-06 history floor for non-Yingbin stores|falls back to Yingbin full-history backfill once the recent window is complete"`

Expected: FAIL because planner still uses the old generic candidate window behavior.

### Task 2: Implement the minimal policy resolver

**Files:**
- Modify: `src/app/sync-service.ts`

**Step 1: Add store policy constants**

Add minimal constants for:

- Yingbin full-history start `2018-12-02`
- shared 4-store floor `2025-10-06`
- explicit store matchers for the current 5 stores

**Step 2: Add a small resolver**

Implement a helper returning candidate backfill ranges for the current store:

- Yingbin: `[recent30..end, fullHistoryStart..end]`
- 4 stores: `[max(globalStart, sharedFloor)..end]`
- unknown stores: preserve legacy behavior

**Step 3: Wire the resolver into `buildCoverageAwareNightlyHistoryBackfillPlans()`**

Replace the inline candidate-range selection with the helper output, keeping the rest of the planner unchanged.

### Task 3: Verify green

**Files:**
- Test: `src/app/sync-service.test.ts`
- Test: `src/runtime.test.ts`

**Step 1: Re-run the new service tests**

Run: `npx vitest run src/app/sync-service.test.ts -t "uses the shared 2025-10-06 history floor for non-Yingbin stores|falls back to Yingbin full-history backfill once the recent window is complete"`

Expected: PASS

**Step 2: Run broader regression**

Run: `npx vitest run src/app/sync-service.test.ts src/runtime.test.ts`

Expected: PASS

### Task 4: Close out

**Files:**
- Modify: `docs/plans/2026-04-17-store-history-backfill-policy-design.md` if implementation details diverge

**Step 1: Summarize exact behavior change**

Record:

- which stores are bounded at `2025-10-06`
- how Yingbin continues full-history recovery
- exact test commands executed
