# Hetang Phase 2 Production Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete Hetang Ops phase 2 by adding authoritative scheduler status, queue observability and replay, richer semantic routing slots, read-only query API expansion, and deploy/recovery assets.

**Architecture:** Keep the current OpenClaw gateway as the synchronous facade, keep scheduled and analysis workers physically split, and make phase 2 visible and operable through one scheduler registry, queue summaries, and read-only runtime endpoints. The implementation stays incremental: reuse existing tables and workers, harden their observability and operational surfaces, and avoid introducing a new runtime stack.

**Tech Stack:** TypeScript, Vitest, PostgreSQL, FastAPI, psycopg2, systemd shell scripts

---

### Task 1: Add failing tests for scheduler, queue, and semantic slot status

**Files:**
- Modify: `extensions/hetang-ops/src/runtime.test.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts`
- Modify: `extensions/hetang-ops/src/command.test.ts`
- Modify: `extensions/hetang-ops/src/query-semantics.test.ts`
- Modify: `extensions/hetang-ops/src/query-route-registry.test.ts`

**Step 1:** Add tests for authoritative scheduler summaries and queue summaries in runtime.

**Step 2:** Add tests for dead-letter listing and replay in store.

**Step 3:** Add command tests for `/hetang queue status`, `/hetang queue deadletters`, and `/hetang queue replay`.

**Step 4:** Add semantic-slot tests for store/time/object/metric/action resolution.

### Task 2: Implement scheduler registry and queue/runtime summaries

**Files:**
- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/schedule.ts`
- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1:** Add shared types for scheduler registry entries, queue summaries, and analysis dead letters.

**Step 2:** Refactor schedule definitions into one authoritative registry and derive due jobs from it.

**Step 3:** Add store methods for latest scheduled run times, queue summaries, dead-letter listing, and replay.

**Step 4:** Add runtime methods that expose scheduler status, queue status, dead-letter listing, and replay.

### Task 3: Expose phase 2 operations on the command and query-api surfaces

**Files:**
- Modify: `extensions/hetang-ops/src/access.ts`
- Modify: `extensions/hetang-ops/src/command.ts`
- Modify: `extensions/hetang-ops/api/main.py`
- Modify: `extensions/hetang-ops/api/test_main.py`

**Step 1:** Add a `queue` command surface with status, dead-letter list, and replay.

**Step 2:** Enrich `/hetang status` with scheduler/queue visibility via runtime summaries.

**Step 3:** Expand the read-only query API with `health`, runtime scheduler/queue/data-freshness, and stable serving-view endpoints.

### Task 4: Upgrade semantic routing to typed five-slot semantics

**Files:**
- Modify: `extensions/hetang-ops/src/query-semantics.ts`
- Modify: `extensions/hetang-ops/src/query-route-registry.ts`
- Modify: `extensions/hetang-ops/src/query-intent.ts`

**Step 1:** Add typed store/time/object/metric/action slots.

**Step 2:** Feed route resolution from slots instead of only ad-hoc booleans.

**Step 3:** Keep current route behavior stable while improving new-query fallback quality.

### Task 5: Codify deployment recovery and DB-role assets

**Files:**
- Modify: `scripts/hetang-scheduled-worker.sh`
- Modify: `scripts/hetang-analysis-worker.sh`
- Add: `scripts/install-hetang-phase2-services.sh`
- Add: `scripts/check-hetang-phase2-services.sh`
- Add: `scripts/rollback-hetang-phase2-services.sh`
- Add: `extensions/hetang-ops/sql/provision-query-readonly-role.sql`
- Add: `extensions/hetang-ops/sql/provision-worker-roles.sql`

**Step 1:** Make worker launch scripts prefer deployment artifacts in `dist/`.

**Step 2:** Add service install/check/rollback scripts so host recovery is reproducible.

**Step 3:** Add SQL assets for query/sync/analysis role separation.

### Task 6: Verify phase 2 end-to-end

**Files:**
- Verify only

**Step 1:** Run targeted Vitest suites for touched Hetang surfaces.

**Step 2:** Run the Python unit tests for the query API.

**Step 3:** Run `pnpm build`.
