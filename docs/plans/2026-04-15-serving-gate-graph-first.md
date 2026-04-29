# Serving Gate Graph-First Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the serving query plane trust `QueryPlan + Capability Graph` selection directly instead of relying on a separate heuristic allowlist.

**Architecture:** Keep the existing serving/runtime fork, but remove the early heuristic gate inside `tryExecuteServingQueryPlane()`. The function should build the plan, ask the capability graph for a `serving_sql` node, and proceed only when a serving node exists. Add a regression test that proves serving still executes when the heuristic would have said "no" but the graph says "yes".

**Tech Stack:** TypeScript, Vitest, capability graph selection, query plan builder, serving executor.

---

### Task 1: Add a red regression test for serving gate drift

**Files:**
- Modify: `src/query-engine-modules.test.ts`

**Step 1: Write the failing test**

Add a test that:
- constructs a valid synthetic `customer_segment` intent
- ensures the old heuristic would not whitelist it
- verifies `tryExecuteServingQueryPlane()` should still execute serving because the capability graph selects `customer_ranked_list_lookup_v1`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/query-engine-modules.test.ts`

Expected: FAIL because `tryExecuteServingQueryPlane()` still exits early on the heuristic.

### Task 2: Remove the heuristic gate from serving dispatch

**Files:**
- Modify: `src/query-engine-executor.ts`
- Modify: `src/query-engine-router.ts`

**Step 1: Write the minimal implementation**

Change `tryExecuteServingQueryPlane()` so it:
- only checks runtime support availability
- always builds the query plan
- asks the capability graph for a `serving_sql` node
- returns `null` only when no serving node exists or execution falls through

Remove the now-unused router heuristic export if it becomes dead code.

**Step 2: Run the focused tests**

Run: `pnpm exec vitest run src/query-engine-modules.test.ts`

Expected: PASS.

### Task 3: Run broader query-plane verification

**Files:**
- No new files required

**Step 1: Verify serving/runtime query behavior still passes**

Run:
- `pnpm exec vitest run src/query-engine-modules.test.ts src/query-engine.test.ts`

Expected: PASS.

### Task 4: Final verification

Run:
- `pnpm exec vitest run src/query-engine-modules.test.ts src/query-engine.test.ts src/route-eval.test.ts`

Expected: PASS with 0 failures.
