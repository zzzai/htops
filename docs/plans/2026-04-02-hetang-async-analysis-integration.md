# Hetang Async Analysis Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate the first 2.0 architecture slice into the current Hetang project by adding deep-analysis routing, async CrewAI job execution, and WeCom delivery without disrupting existing fast-query behavior.

**Architecture:** Keep the current `企微 -> OpenClaw -> hetang-ops -> PostgreSQL` path as the source of truth. Add a lightweight analysis router, a PostgreSQL-backed async job queue, and a CrewAI sidecar runner so deep-analysis requests are acknowledged immediately, executed in the background, and delivered back into WeCom when ready.

**Tech Stack:** TypeScript, Vitest, PostgreSQL (`pg` + `pg-mem`), existing `HetangOpsRuntime` / `HetangOpsStore`, local Python CrewAI sidecar.

---

### Task 1: Lock async analysis routing with failing tests

**Files:**

- Modify: `extensions/hetang-ops/src/query-intent.test.ts`
- Modify: `extensions/hetang-ops/src/inbound.test.ts`
- Modify: `extensions/hetang-ops/src/runtime.test.ts`

**Steps:**

1. Write a failing intent test for a deep-analysis query like `义乌店近7天经营复盘`.
2. Run the targeted intent test and verify it fails because there is no deep-analysis route.
3. Write a failing inbound/runtime test proving the request is enqueued and returns an immediate progress reply.
4. Run the targeted tests and verify they fail for the expected missing behavior.

### Task 2: Add PostgreSQL-backed analysis job persistence

**Files:**

- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts`

**Steps:**

1. Write failing store tests for creating, listing, starting, finishing, and failing analysis jobs.
2. Run the store test and verify it fails because the schema/methods do not exist yet.
3. Add the minimal job table and CRUD helpers in `store.ts`.
4. Re-run the store test and verify it passes.

### Task 3: Add runtime enqueue/execute helpers

**Files:**

- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/runtime.test.ts`

**Steps:**

1. Write failing runtime tests for `enqueueAnalysisJob()` and `runPendingAnalysisJobs()`.
2. Run the runtime test and verify it fails with missing methods.
3. Implement minimal runtime helpers that use store persistence and a pluggable sidecar runner.
4. Re-run the runtime tests and verify they pass.

### Task 4: Wire inbound flow and background service

**Files:**

- Create: `extensions/hetang-ops/src/analysis-router.ts`
- Modify: `extensions/hetang-ops/src/inbound.ts`
- Modify: `extensions/hetang-ops/src/service.ts`
- Modify: `extensions/hetang-ops/src/service.test.ts`

**Steps:**

1. Write failing tests proving deep-analysis queries bypass the synchronous query path and enqueue background work.
2. Run the targeted tests and verify they fail.
3. Implement the analysis router and service loop integration so pending jobs execute in the background.
4. Re-run the targeted tests and verify they pass.

### Task 5: Add CrewAI sidecar invocation seam

**Files:**

- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/runtime.test.ts`

**Steps:**

1. Add a failing runtime test proving the sidecar command is called with org/start/end parameters and its output is delivered.
2. Run the test and verify it fails before implementation.
3. Implement the command runner seam using the existing local Python sidecar.
4. Re-run the test and verify it passes.

### Task 6: Verify the integration slice

**Files:**

- Test: `extensions/hetang-ops/src/*.test.ts`

**Steps:**

1. Run the targeted tests for query intent, inbound, store, runtime, and service.
2. Run the full `extensions/hetang-ops` suite.
3. Run `pnpm build`.
4. Spot-check the generated async-analysis response flow with the CLI/runtime path where feasible.
