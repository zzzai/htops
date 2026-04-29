# Daily Report Window Audit Control Plane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a non-blocking scheduled-worker audit that reconciles the recent daily-report window, persists a compact quality summary into the control plane, and exposes it through `doctor`.

**Architecture:** Keep audit execution bounded to the existing daily-report reconciliation owner path. Introduce one new sync-side scheduled job that runs after `build-report`, writes a compact summary into existing `scheduled_job_state`, and lets `admin-read-service` / `doctor` render that state without adding new business responsibilities to `runtime.ts`.

**Tech Stack:** TypeScript, Vitest, PostgreSQL-backed `HetangOpsStore`, existing scheduler control-plane modules, daily metric reconciliation.

---

### Task 1: Lock the new scheduled job into the control-plane contract

**Files:**
- Modify: `src/control-plane-contract.json`
- Modify: `src/types.ts`
- Modify: `src/schedule.ts`
- Test: `src/schedule.test.ts`

**Step 1: Write the failing test**

Extend scheduler catalog / due-job tests so they expect a new sync-side job `audit-daily-report-window`:
- present in the authoritative catalog
- emitted after `build-report`
- suppressed when already completed
- waiting when `build-report` is incomplete

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/schedule.test.ts`

Expected: FAIL because the new job type is not registered.

**Step 3: Write minimal implementation**

Add `audit-daily-report-window` to:
- `src/control-plane-contract.json`
- `ScheduledJobType` in `src/types.ts`
- `SCHEDULER_JOB_REGISTRY` in `src/schedule.ts`

Keep it on the `sync` orchestrator with the same run key as `build-report`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/schedule.test.ts`

Expected: PASS

### Task 2: Add the failing owner-module tests for window audit aggregation

**Files:**
- Create: `src/daily-report-window-audit.ts`
- Create: `src/daily-report-window-audit.test.ts`

**Step 1: Write the failing test**

Add unit tests for a small owner module that:
- picks the latest `windowDays` report dates up to `endBizDate`
- reconciles every active store for each date
- returns a compact aggregate summary
- keeps only a small number of sample issues

Cover one healthy window and one warning window with diffs / unaudited keys.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/daily-report-window-audit.test.ts`

Expected: FAIL because the module does not exist yet.

**Step 3: Write minimal implementation**

Create `src/daily-report-window-audit.ts` with:
- audit summary types
- compact line rendering
- window aggregation over `reconcileDailyStoreMetrics(...)`

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/daily-report-window-audit.test.ts`

Expected: PASS

### Task 3: Teach the sync orchestrator to run and persist the audit

**Files:**
- Modify: `src/sync-orchestrator.ts`
- Modify: `src/sync-orchestrator.test.ts`

**Step 1: Write the failing test**

Add tests that prove:
- the sync orchestrator waits for `build-report` before running `audit-daily-report-window`
- once `build-report` is complete, it runs the audit, writes `scheduled_job_state`, and marks the audit job completed
- audit diffs do not block later jobs

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync-orchestrator.test.ts`

Expected: FAIL because the orchestrator does not know this job or state write.

**Step 3: Write minimal implementation**

Extend orchestrator deps with one owner call for the audit and persist its summary via `setScheduledJobState`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sync-orchestrator.test.ts`

Expected: PASS

### Task 4: Surface the stored summary through admin-read and doctor formatting

**Files:**
- Modify: `src/types.ts`
- Modify: `src/app/admin-read-service.ts`
- Modify: `src/app/admin-read-service.test.ts`
- Modify: `src/ops/doctor.ts`
- Modify: `src/ops/doctor.test.ts`

**Step 1: Write the failing tests**

Add tests that expect:
- `getSchedulerStatus(...)` to include `dailyReportAuditSummary`
- `observabilityStreams` to contain a dedicated daily report audit stream
- `doctor` formatting to render healthy / warn / no-runs lines

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/admin-read-service.test.ts src/ops/doctor.test.ts`

Expected: FAIL because no summary field or formatter exists.

**Step 3: Write minimal implementation**

Add:
- summary types to `src/types.ts`
- state resolution in `src/app/admin-read-service.ts`
- compact formatter in `src/ops/doctor.ts`

Wire the runtime doctor report through the existing `schedulerStatus` object only.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/admin-read-service.test.ts src/ops/doctor.test.ts`

Expected: PASS

### Task 5: Run focused verification

**Files:**
- Modify: none unless a verification failure exposes a bug

**Step 1: Run focused suites**

Run:
- `npx vitest run src/schedule.test.ts`
- `npx vitest run src/daily-report-window-audit.test.ts`
- `npx vitest run src/sync-orchestrator.test.ts`
- `npx vitest run src/app/admin-read-service.test.ts src/ops/doctor.test.ts`

Expected: PASS

**Step 2: Run integration-adjacent suites**

Run:
- `npx vitest run src/sync-orchestrator-five-store-overview.test.ts src/sync-orchestrator-weekly-report.test.ts src/sync-orchestrator-weekly-chart.test.ts`
- `npx tsc -p tsconfig.json --noEmit`

Expected: PASS

### Task 6: Verify with live recent-window audit

**Files:**
- Modify: none

**Step 1: Run a read-only live audit sweep**

Run a `node --import tsx -e ...` command that executes the new owner module or equivalent reconciliation aggregation over the latest 7 report dates.

Expected:
- summary state is healthy for the current recent window
- no fresh/stored mismatches on current live data

### Task 7: Commit

**Files:**
- Modify: implementation/test/docs files touched above

**Step 1: Stage only the files from this task**

```bash
git add docs/plans/2026-04-26-daily-report-window-audit-control-plane-implementation-plan.md src/control-plane-contract.json src/types.ts src/schedule.ts src/schedule.test.ts src/daily-report-window-audit.ts src/daily-report-window-audit.test.ts src/sync-orchestrator.ts src/sync-orchestrator.test.ts src/app/admin-read-service.ts src/app/admin-read-service.test.ts src/ops/doctor.ts src/ops/doctor.test.ts
```

**Step 2: Commit**

```bash
git commit -m "feat: add daily report window audit control-plane summary"
```
