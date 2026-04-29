# Legacy Scheduled Poller Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the stale legacy `scheduled` service-poller state once split scheduled pollers write fresh outcomes, so doctor and Query API converge on authoritative pollers only.

**Architecture:** Keep cleanup inside the poller status owner path. Add a minimal `deleteScheduledJobState()` store primitive, call it from `HetangAdminReadService.recordServicePollerOutcome()` for `scheduled-sync` / `scheduled-delivery`, and verify the runtime surfaces stop showing legacy state after the next write.

**Tech Stack:** TypeScript, Vitest, existing Postgres-backed store wrappers

---

### Task 1: Lock cleanup behavior with tests

**Files:**
- Modify: `src/app/admin-read-service.test.ts`
- Modify: `src/runtime.test.ts`

**Step 1: Write the failing tests**

- Add an admin-read-service test asserting split poller outcome persistence also deletes `service-poller/scheduled`.
- Add a runtime-level delegation test asserting `recordServicePollerOutcome()` triggers the same cleanup through the mocked store.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/admin-read-service.test.ts src/runtime.test.ts`

Expected: FAIL because `deleteScheduledJobState` is not defined/called yet.

### Task 2: Implement minimal cleanup path

**Files:**
- Modify: `src/store.ts`
- Modify: `src/store/queue-access-control-store.ts`
- Modify: `src/app/admin-read-service.ts`

**Step 1: Add store primitive**

- Add `deleteScheduledJobState(jobType, stateKey)` to the legacy store and queue wrapper.
- Implement it in `HetangOpsStore` with a single `DELETE FROM scheduled_job_state ...` query.

**Step 2: Wire cleanup into poller persistence**

- After writing an authoritative scheduled poller outcome, delete the legacy `service-poller/scheduled` row.
- Keep cleanup best-effort and inside the existing persistence error boundary.

**Step 3: Run targeted tests**

Run: `npx vitest run src/app/admin-read-service.test.ts src/runtime.test.ts`

Expected: PASS.

### Task 3: Verify control-plane surfaces stay green

**Files:**
- Modify: none unless regression appears

**Step 1: Run regression suite**

Run: `npx vitest run src/runtime.test.ts src/sync-orchestrator.test.ts src/service.test.ts src/schedule.test.ts src/app/admin-read-service.test.ts src/app/reporting-service.test.ts src/ops/doctor.test.ts`

Run: `api/.venv/bin/python -m unittest api.test_main`

Expected: PASS.

**Step 2: Run runtime acceptance**

Run: `systemctl restart htops-scheduled-worker.service`

Run: `node --import tsx src/main.ts hetang doctor`

Run: `curl -sf http://127.0.0.1:18890/api/v1/runtime/scheduler`

Expected: no legacy `scheduled` warning after the next split poller write.
