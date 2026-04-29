# Hetang Query Read Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the remaining query/read-heavy runtime methods into a dedicated owner service so `src/runtime.ts` keeps shrinking toward a true compatibility facade.

**Architecture:** Add `src/app/query-read-service.ts` as the owner of read-only business queries and serving-query passthroughs. Keep `HetangOpsRuntime` methods and call signatures stable, but make them thin delegations to the new service; preserve store/runtime-shell compatibility instead of changing callers.

**Tech Stack:** TypeScript, Vitest, PostgreSQL-backed store facade, existing runtime shell.

---

### Task 1: Lock query-read behavior with tests

**Files:**
- Create: `src/app/query-read-service.test.ts`

**Step 1: Write the failing test**

Add one test for tech leaderboard aggregation and one test for optional read surfaces returning `[]` instead of throwing.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/query-read-service.test.ts`
Expected: FAIL because `src/app/query-read-service.ts` does not exist yet.

**Step 3: Write minimal implementation**

Create `src/app/query-read-service.ts` with only the read methods that are currently duplicated inside `src/runtime.ts`.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/query-read-service.test.ts`
Expected: PASS

### Task 2: Delegate runtime read proxies

**Files:**
- Modify: `src/runtime.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write the failing test**

Add or extend runtime coverage so at least one representative read path still works through the runtime surface after delegation.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/runtime.test.ts -t "leaderboard|serving version|compiled serving"`
Expected: FAIL if delegation is not wired.

**Step 3: Write minimal implementation**

Instantiate `HetangQueryReadService` inside runtime and delegate the read methods to it.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/runtime.test.ts -t "leaderboard|serving version|compiled serving"`
Expected: PASS

### Task 3: Focused regression

**Files:**
- Modify if needed: `src/app/query-read-service.ts`, `src/runtime.ts`

**Step 1: Run focused regression**

Run: `pnpm exec vitest run src/app/query-read-service.test.ts src/runtime.test.ts src/service.test.ts src/store.test.ts src/sync.test.ts`

**Step 2: Fix regressions**

Only fix regressions introduced by this extraction.

**Step 3: Final verification**

Run: `pnpm test`
Expected: PASS
