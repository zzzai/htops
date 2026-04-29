# Daily Metric Reconciliation Window Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand daily metric reconciliation so it treats explicit `null` values correctly and live-audits the current daily-report window metrics that operators actually read.

**Architecture:** Keep the reconciliation tool bounded to the existing daily-report pipeline. Reuse the same metric formulas already used by `computeDailyStoreMetrics(...)` for `groupbuy*`, and reuse the same window-signal precedence the report builder uses for `memberRepurchase*` so reconciliation reflects the actual stored report output instead of inventing a second truth source.

**Tech Stack:** TypeScript, Vitest, PostgreSQL-backed store facades, existing `metrics.ts` and report window views.

---

### Task 1: Lock in the failing audit-state test

**Files:**
- Modify: `src/daily-metric-reconciliation.test.ts`
- Test: `src/daily-metric-reconciliation.test.ts`

**Step 1: Write the failing test**

Add/keep the test that expects `roomOccupancyRate` to reconcile as `match` when `expected`, `fresh`, and stored values are all intentionally unavailable via explicit `null`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/daily-metric-reconciliation.test.ts -t "treats explicit stored null values as matches when the metric is intentionally unavailable"`

Expected: FAIL because `missing_stored` is reported instead of `match`.

**Step 3: Write minimal implementation**

Adjust audit-state classification so explicit stored `null` is considered present when it matches an intentionally unavailable metric.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/daily-metric-reconciliation.test.ts -t "treats explicit stored null values as matches when the metric is intentionally unavailable"`

Expected: PASS

### Task 2: Add failing tests for newly audited live window metrics

**Files:**
- Modify: `src/daily-metric-reconciliation.test.ts`
- Test: `src/daily-metric-reconciliation.test.ts`

**Step 1: Write the failing tests**

Add tests that prove reconciliation now audits:
- `groupbuyCohortCustomerCount`
- `groupbuy7dRevisit*`
- `groupbuy7dCardOpened*`
- `groupbuy7dStoredValue*`
- `groupbuy30dMemberPay*`
- `groupbuyFirstOrder*`
- `memberRepurchaseBaseCustomerCount7d`
- `memberRepurchaseReturnedCustomerCount7d`
- `memberRepurchaseRate7d`

Cover one case where stored values drift from expected and one case where member-repurchase values come from `review7d/summary30d` rows rather than raw daily metrics.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/daily-metric-reconciliation.test.ts`

Expected: FAIL because the metrics still appear in `unauditedMetricKeys` or are not compared with the correct live source.

**Step 3: Write minimal implementation**

Extend reconciliation inputs and audit item generation so these metrics are included.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/daily-metric-reconciliation.test.ts`

Expected: PASS

### Task 3: Share the report-style member repurchase resolution

**Files:**
- Create: `src/report-window-signals.ts`
- Modify: `src/report.ts`
- Modify: `src/daily-metric-reconciliation.ts`
- Test: `src/report-build.test.ts`
- Test: `src/daily-metric-reconciliation.test.ts`

**Step 1: Write the failing test**

Add/adjust tests so both report-building and reconciliation depend on the same precedence:
- prefer `review7d.memberRepurchase*`
- else `summary30d.memberRepurchase*`
- else fall back to the base metrics object

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/report-build.test.ts src/daily-metric-reconciliation.test.ts`

Expected: FAIL until the shared helper exists and both call sites use it.

**Step 3: Write minimal implementation**

Extract a small shared helper that reads review/summary rows and returns the resolved `memberRepurchase*` values. Use it in:
- `buildDailyStoreReport(...)` enrichment
- reconciliation fresh/expected-window metric handling

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/report-build.test.ts src/daily-metric-reconciliation.test.ts`

Expected: PASS

### Task 4: Wire reconciliation to audit the new metrics

**Files:**
- Modify: `src/daily-metric-reconciliation.ts`
- Test: `src/daily-metric-reconciliation.test.ts`

**Step 1: Write the failing test**

Add assertions that:
- the new metrics no longer appear in `unauditedMetricKeys`
- `storedMismatchCount` reflects drift on those metrics
- `matchCount` increases when they line up

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/daily-metric-reconciliation.test.ts`

Expected: FAIL until reconciliation summary and item lists include the new metrics.

**Step 3: Write minimal implementation**

Update reconciliation to:
- fetch `review7d` and `summary30d` rows
- build a current “fresh report metric” view for audited keys
- add audit items for the new `groupbuy*` and `memberRepurchase*` metrics

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/daily-metric-reconciliation.test.ts`

Expected: PASS

### Task 5: Verify targeted suites

**Files:**
- Modify: none unless verification exposes a bug
- Test: `src/daily-metric-reconciliation.test.ts`
- Test: `src/report-build.test.ts`
- Test: `src/metrics-truth-validation.test.ts`
- Test: `src/sync-and-report.test.ts`

**Step 1: Run focused suites**

Run:
- `npx vitest run src/daily-metric-reconciliation.test.ts`
- `npx vitest run src/report-build.test.ts`
- `npx vitest run src/metrics-truth-validation.test.ts`
- `npx vitest run src/sync-and-report.test.ts -t "computes business-facing groupbuy conversion funnel metrics from rolling customer history"`

Expected: PASS

**Step 2: If any suite fails, fix the smallest root cause**

Only patch behavior directly related to reconciliation/window-signal reuse.

**Step 3: Re-run the exact failing command**

Expected: PASS

### Task 6: Verify with live reconciliation on recent data

**Files:**
- Modify: none

**Step 1: Run live reconciliation against recent store-days**

Run a read-only `node --import tsx -e ...` reconciliation sweep for the latest 7 business days across active stores.

Expected:
- `reportsWithFreshMismatch = 0`
- `reportsWithStoredMismatch = 0`
- reduced `maxUnauditedMetricCount` relative to the current baseline

**Step 2: Record remaining unaudited keys**

Keep the response explicit about what still is not independently audited after this scope cut.

### Task 7: Commit

**Files:**
- Modify: `docs/plans/2026-04-25-daily-metric-reconciliation-window-audit-implementation-plan.md`
- Modify: implementation/test files touched above

**Step 1: Stage only the files from this task**

```bash
git add docs/plans/2026-04-25-daily-metric-reconciliation-window-audit-implementation-plan.md src/report-window-signals.ts src/report.ts src/daily-metric-reconciliation.ts src/daily-metric-reconciliation.test.ts src/report-build.test.ts
```

**Step 2: Commit**

```bash
git commit -m "feat: expand daily metric live reconciliation coverage"
```
