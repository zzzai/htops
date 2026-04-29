# Hetang Night Window Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework the `03:00-04:00` nightly sync so stores run in fixed priority order, endpoints run wave-by-wave across stores, and `1.4` only scans candidate member cards.

**Architecture:** Keep PostgreSQL and the existing sync worker. Change only the orchestration contract in `runtime.ts`, the `1.4` execution path in `sync.ts`, and add a candidate-card helper in `store.ts`. Preserve current sync-run/error recording behavior.

**Tech Stack:** TypeScript, Vitest, pg/pg-mem

---

### Task 1: Lock the new nightly orchestration contract with tests

**Files:**
- Modify: `src/runtime.test.ts`

**Step 1: Write the failing test**

Add tests that expect:
- `syncStores()` to execute `1.1 -> 1.2 -> 1.3 -> 1.5 -> 1.6 -> 1.7 -> 1.8 -> 1.4`
- stores to run in configured priority order
- `1.4` to receive `selectedCardIds` instead of full scans

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: failure because runtime still uses broad phases and does not pass candidate cards.

**Step 3: Write minimal implementation**

Modify `src/runtime.ts` to:
- normalize nightly store order
- run endpoint waves one by one
- estimate `1.4` using candidate-card counts
- defer only when the remaining access window is insufficient

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: PASS

### Task 2: Lock candidate-card-driven `1.4` behavior with tests

**Files:**
- Modify: `src/sync.test.ts`

**Step 1: Write the failing test**

Add tests that expect:
- `syncHetangStore()` to request only `selectedCardIds`
- an empty `selectedCardIds` list to skip outbound `1.4` calls
- single-endpoint tech runs to avoid unnecessary 15s cooldowns

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/sync.test.ts`

Expected: failure because `syncUserTrades()` still scans all cards and tech cooldowns still fire between skipped endpoints.

**Step 3: Write minimal implementation**

Modify `src/sync.ts` to:
- extend `HetangSyncPlan` with `selectedCardIds`
- make `syncUserTrades()` honor that list
- short-circuit empty candidate sets
- only apply tech cooldowns between scheduled tech endpoints

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/sync.test.ts`

Expected: PASS

### Task 3: Add candidate-card derivation from existing warehouse facts

**Files:**
- Modify: `src/store.ts`
- Modify: `src/runtime.ts`

**Step 1: Write the failing test**

Use the runtime tests from Task 1 to prove runtime needs a candidate-card source.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: failure until runtime can resolve candidate cards.

**Step 3: Write minimal implementation**

Add a `store.ts` helper that derives candidate cards from:
- current member card snapshots
- recent recharge bills
- recent consume bills
- recent `LastUseTime`

Then call it from `runtime.ts` for the nightly `1.4` wave.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime.test.ts src/sync.test.ts`

Expected: PASS

### Task 4: Verify the end-to-end change set

**Files:**
- Verify only

**Step 1: Run focused tests**

Run: `pnpm vitest run src/runtime.test.ts src/sync.test.ts`

Expected: PASS

**Step 2: Run broader sync-related regression tests**

Run: `pnpm vitest run src/runtime.test.ts src/sync.test.ts src/sync-and-report.test.ts`

Expected: PASS

**Step 3: Capture residual risks**

Document any remaining gap, especially around long-history `1.4` recovery for the priority store.
