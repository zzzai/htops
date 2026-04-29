# Store Environment Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PostgreSQL-backed per-store daily environment memory snapshots that automatically classify weekday / Chinese holiday context / solar term / historical weather tags, keep them hidden by default from report text, and expose them to analysis, world-model, reporting gates, and doctor/admin reads.

**Architecture:** Keep the approved `environment-context` path as the deterministic classification core, then add a dedicated environment-memory owner path: `holiday calendar + weather observation + store master location -> environment memory builder -> snapshot store -> bounded readers`. Do not expand `src/runtime.ts`, do not introduce a second ontology runtime, and do not let AI decide calendar or weather truth.

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, existing `src/customer-growth/environment-context.ts`, `src/store.ts`, `src/schedule.ts`, `src/sync-orchestrator.ts`, `src/app/admin-read-service.ts`, `src/ops/doctor.ts`

---

### Task 1: Extend environment contracts for long-term memory

**Files:**
- Modify: `src/types.ts`
- Modify: `src/environment-context.test.ts`
- Modify: `src/customer-growth/environment-context.ts`

**Step 1: Write the failing test**

Add assertions in `src/environment-context.test.ts` for:

- `holidayTag` supporting `adjusted_workday`
- derived `weekdayLabel`
- derived `environmentDisturbanceLevel`
- derived `narrativePolicy`

Example expectation:

```ts
expect(snapshot).toMatchObject({
  holidayTag: "adjusted_workday",
  weekdayLabel: "周日",
  environmentDisturbanceLevel: "high",
  narrativePolicy: "mention",
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts
```

Expected:

- FAIL because the current environment snapshot contract does not expose the new memory-oriented fields.

**Step 3: Write minimal implementation**

- Extend `EnvironmentHolidayTag` in `src/types.ts`
- Add the new environment memory fields to `EnvironmentContextSnapshot`
- Update `src/customer-growth/environment-context.ts` so deterministic derivation can output the new fields

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts
```

Expected:

- PASS with the new contract still keeping bounded weather precedence intact.

**Step 5: Commit**

```bash
git add src/types.ts src/environment-context.test.ts src/customer-growth/environment-context.ts
git commit -m "feat: extend environment context contracts for memory snapshots"
```

---

### Task 2: Add holiday calendar and environment snapshot persistence

**Files:**
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

Add store-level tests covering:

- upsert / read for `china_holiday_calendar_days`
- upsert / read for `store_environment_daily_snapshots`
- overwrite update behavior on the same `org_id + biz_date`

Example expectation:

```ts
expect(snapshot?.holidayTag).toBe("holiday");
expect(snapshot?.narrativePolicy).toBe("mention");
expect(snapshot?.weatherTag).toBe("rain");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/store.test.ts -t "environment memory"
```

Expected:

- FAIL because the new tables and store methods do not exist.

**Step 3: Write minimal implementation**

In `src/store.ts`:

- create `china_holiday_calendar_days`
- create `store_environment_daily_snapshots`
- add store methods for:
  - `upsertHolidayCalendarDay(...)`
  - `getHolidayCalendarDay(...)`
  - `upsertStoreEnvironmentDailySnapshot(...)`
  - `getStoreEnvironmentDailySnapshot(...)`
  - `listStoreEnvironmentDailySnapshots(...)`

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/store.test.ts -t "environment memory"
```

Expected:

- PASS with stable PostgreSQL-backed round-trips.

**Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts
git commit -m "feat: add environment memory persistence tables"
```

---

### Task 3: Build the environment memory owner module and app service

**Files:**
- Add: `src/environment-memory.ts`
- Add: `src/environment-memory.test.ts`
- Add: `src/app/environment-memory-service.ts`
- Add: `src/app/environment-memory-service.test.ts`
- Modify: `src/store-master-profile.ts`

**Step 1: Write the failing test**

Add tests for:

- deriving a memory snapshot from:
  - `bizDate`
  - holiday calendar day
  - weather observation
  - store location / master profile
- suppressing narrative output on normal workdays
- escalating disturbance on holiday and severe-weather cases

Example expectation:

```ts
expect(result.snapshot.narrativePolicy).toBe("suppress");
expect(result.snapshot.environmentDisturbanceLevel).toBe("none");
expect(result.snapshot.weekdayLabel).toBe("周三");
```

And for a holiday / storm case:

```ts
expect(result.snapshot.environmentDisturbanceLevel).toBe("high");
expect(result.snapshot.narrativePolicy).toBe("mention");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/environment-memory.test.ts src/app/environment-memory-service.test.ts
```

Expected:

- FAIL because the owner module and service do not exist yet.

**Step 3: Write minimal implementation**

Create `src/environment-memory.ts` with:

- snapshot contract helpers
- `resolveWeekdayLabel(...)`
- disturbance rules
- narrative policy mapping
- builder that reuses `buildEnvironmentContextSnapshot(...)`

Create `src/app/environment-memory-service.ts` with:

- `buildStoreEnvironmentMemory(...)`
- `ensureStoreEnvironmentMemory(...)`
- `getStoreEnvironmentMemory(...)`

Use store master location fields as the primary weather lookup anchor.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/environment-memory.test.ts src/app/environment-memory-service.test.ts
```

Expected:

- PASS with deterministic and provider-free tests.

**Step 5: Commit**

```bash
git add src/environment-memory.ts src/environment-memory.test.ts src/app/environment-memory-service.ts src/app/environment-memory-service.test.ts src/store-master-profile.ts
git commit -m "feat: add store environment memory builder service"
```

---

### Task 4: Schedule automatic daily environment memory builds

**Files:**
- Modify: `src/types.ts`
- Modify: `src/schedule.ts`
- Modify: `src/sync-orchestrator.ts`
- Modify: `src/runtime.ts`
- Test: `src/schedule.test.ts`
- Test: `src/sync-orchestrator.test.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write the failing test**

Add tests for:

- new scheduled job type `build-store-environment-memory`
- orchestrator order: sync -> environment memory -> build-report
- idempotent reruns for the same `runKey`

Example expectation:

```ts
expect(lines).toContain("2026-04-22 store environment memory built");
expect(lines).toContain("2026-04-22 build report waiting - environment memory not ready");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/schedule.test.ts src/sync-orchestrator.test.ts src/runtime.test.ts -t "environment memory"
```

Expected:

- FAIL because the scheduler catalog and runtime owner path do not know the new job yet.

**Step 3: Write minimal implementation**

- Add `build-store-environment-memory` to `ScheduledJobType`
- Add schedule definition before `build-report`
- Thread the new owner call through runtime without adding new business routing
- Ensure the orchestrator marks the job completed once all active stores are built

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/schedule.test.ts src/sync-orchestrator.test.ts src/runtime.test.ts -t "environment memory"
```

Expected:

- PASS with the new job safely ordered ahead of reports.

**Step 5: Commit**

```bash
git add src/types.ts src/schedule.ts src/sync-orchestrator.ts src/runtime.ts src/schedule.test.ts src/sync-orchestrator.test.ts src/runtime.test.ts
git commit -m "feat: schedule daily environment memory builds"
```

---

### Task 5: Expose hidden environment memory to bounded readers

**Files:**
- Modify: `src/store-query.ts`
- Modify: `src/query-engine-renderer.ts`
- Modify: `src/world-model/state.ts`
- Modify: `src/app/reporting-service.ts`
- Test: `src/store-query.test.ts`
- Test: `src/query-engine-renderer.test.ts`
- Test: `src/world-model/state.test.ts`
- Test: `src/app/reporting-service.test.ts`

**Step 1: Write the failing test**

Add tests for:

- preferring persisted environment memory over temporary recomputation
- keeping report / five-store overview text silent when `narrativePolicy = suppress`
- allowing a one-line background hint only when `narrativePolicy = hint/mention`
- threading stored environment memory into world-model store state

Example expectation:

```ts
expect(text).not.toContain("天气");
expect(snapshot.storeState.environmentContext?.holidayTag).toBe("pre_holiday");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/store-query.test.ts src/query-engine-renderer.test.ts src/world-model/state.test.ts src/app/reporting-service.test.ts -t "environment memory"
```

Expected:

- FAIL because consumers still rely only on temporary context or always-silent paths.

**Step 3: Write minimal implementation**

- Add read helpers that prefer `store_environment_daily_snapshots`
- Thread snapshot reads into:
  - store advice / analysis explanation
  - world-model assembly
  - reporting / five-store overview gating
- Keep default report text hidden unless the stored narrative policy permits a mention

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/store-query.test.ts src/query-engine-renderer.test.ts src/world-model/state.test.ts src/app/reporting-service.test.ts -t "environment memory"
```

Expected:

- PASS with hidden-by-default behavior preserved.

**Step 5: Commit**

```bash
git add src/store-query.ts src/query-engine-renderer.ts src/world-model/state.ts src/app/reporting-service.ts src/store-query.test.ts src/query-engine-renderer.test.ts src/world-model/state.test.ts src/app/reporting-service.test.ts
git commit -m "feat: thread environment memory into bounded readers"
```

---

### Task 6: Add observability for hidden environment memory readiness

**Files:**
- Modify: `src/app/admin-read-service.ts`
- Modify: `src/app/admin-read-service.test.ts`
- Modify: `src/ops/doctor.ts`
- Modify: `src/ops/doctor.test.ts`

**Step 1: Write the failing test**

Add tests for:

- readiness summary for the current report business day
- recent disturbance summary for the last 7 days
- distinguishing `missing weather`, `missing holiday`, and `fallback-only`

Example expectation:

```ts
expect(summary.status).toBe("ready");
expect(line).toContain("environment_memory");
expect(line).toContain("high_disturbance=1");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/admin-read-service.test.ts src/ops/doctor.test.ts -t "environment memory"
```

Expected:

- FAIL because admin/doctor do not yet summarize the new memory layer.

**Step 3: Write minimal implementation**

- Add environment memory summaries to admin read
- Add doctor lines for:
  - current readiness
  - recent disturbance highlights
- Keep these summaries operator-facing only

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/app/admin-read-service.test.ts src/ops/doctor.test.ts -t "environment memory"
```

Expected:

- PASS with clear operator observability and no user-facing text leakage.

**Step 5: Commit**

```bash
git add src/app/admin-read-service.ts src/app/admin-read-service.test.ts src/ops/doctor.ts src/ops/doctor.test.ts
git commit -m "feat: add environment memory observability"
```

---

### Final Verification

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts src/environment-memory.test.ts src/app/environment-memory-service.test.ts src/store.test.ts src/schedule.test.ts src/sync-orchestrator.test.ts src/runtime.test.ts src/store-query.test.ts src/query-engine-renderer.test.ts src/world-model/state.test.ts src/app/reporting-service.test.ts src/app/admin-read-service.test.ts src/ops/doctor.test.ts
pnpm exec tsc --noEmit
```

Expected:

- PASS for all targeted tests
- PASS for TypeScript typecheck

---

Plan complete and saved to `docs/plans/2026-04-23-store-environment-memory-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
