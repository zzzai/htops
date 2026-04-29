# Daily Report Member Followup Metrics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add scientifically defined `高余额沉默会员` and `首充未耗卡` metrics to single-store daily reports using business-date snapshots and event history.

**Architecture:** Keep computation inside the existing daily metrics pipeline. State metrics read from member snapshots on `biz_date`; first-charge followup metrics derive from recharge/trade event history resolved through member-card identity mappings. Report rendering remains a thin consumer of `DailyStoreMetrics`.

**Tech Stack:** TypeScript, Vitest, existing `HetangOpsStore` PostgreSQL access layer

---

### Task 1: Lock the new report expectations

**Files:**
- Modify: `src/report-build.test.ts`

**Steps:**
1. Add expectations for `高余额沉默会员` and `首充未耗卡`.
2. Add expectations that `点钟率` and `加钟率` render in `【详细指标】`.
3. Run the focused test and confirm it fails for the missing lines.

### Task 2: Add metric fields and history access

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/metrics-staffing.test.ts`

**Steps:**
1. Extend `DailyStoreMetrics` with the four member followup fields.
2. Add a `listUserTradesByDateRange(...)` store method.
3. Update compute-metrics test stubs to expose the new range/snapshot reads.

### Task 3: Implement snapshot/cohort calculation

**Files:**
- Modify: `src/metrics.ts`

**Steps:**
1. Prefer member/member-card daily snapshots for the requested `biz_date`, with fallback to current tables.
2. Compute `高余额沉默会员` from the `biz_date` member snapshot using a threshold of `max(1000, positive-balance P80)`.
3. Compute `首充未耗卡` from first recharge event per member versus post-recharge negative-balance trade events up to `biz_date`.
4. Keep the implementation minimal and local to the daily metrics flow.

### Task 4: Render and verify

**Files:**
- Modify: `src/store-manager-daily-detail.ts`

**Steps:**
1. Render the two new member followup lines in `【补充指标】`.
2. Move `点钟率` and `加钟率` into `【详细指标】`.
3. Run focused tests and a broader daily-report sanity pass.
