# Hetang Nightly API Depth Probe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight API-only history-depth probe to the `03:00-04:00` nightly sync flow and persist its result for later inspection.

**Architecture:** Keep the existing `sync` scheduled job intact. Add one small runtime probe method, wire it into the sync orchestrator after nightly sync/backfill, and store the result in `scheduled_job_state` instead of touching warehouse fact tables.

**Tech Stack:** TypeScript, Vitest, PostgreSQL scheduled job state

---

### Task 1: Lock the orchestration behavior with tests

**Files:**
- Modify: `src/runtime.test.ts`
- Modify: `src/sync-orchestrator.ts`

**Step 1: Write the failing test**

Add a test proving that a due `sync` job now returns:

1. daily sync lines
2. nightly backfill lines
3. one extra API depth probe summary line

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: FAIL because the orchestrator does not yet call the probe.

**Step 3: Write minimal implementation**

Wire a new dependency into `HetangSyncOrchestrator` and invoke it after nightly backfill.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: PASS

### Task 2: Lock persistence and summary behavior with tests

**Files:**
- Modify: `src/runtime.test.ts`
- Modify: `src/runtime.ts`

**Step 1: Write the failing test**

Add a test that calls the new nightly probe method directly and expects:

- state to be written via `setScheduledJobState`
- summary text to include confirmed historical depth

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: FAIL because the probe method does not exist yet.

**Step 3: Write minimal implementation**

Implement the probe using a small fixed set of lookback windows and a lightweight API client factory.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: PASS

### Task 3: Verify the change set

**Files:**
- Verify only

**Step 1: Run targeted tests**

Run: `pnpm vitest run src/runtime.test.ts`

Expected: PASS

**Step 2: Run broader regression tests**

Run: `pnpm vitest run src/runtime.test.ts src/sync.test.ts src/sync-and-report.test.ts`

Expected: PASS

**Step 3: Record remaining limitation**

Document that the probe reports “deepest confirmed historical window”, not a mathematically proven absolute upper bound.
