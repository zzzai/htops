# HQ Broad Ranking Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade HQ broad metric status asks like `5个店近一周的营收情况` from a short ranking list into a compact portfolio-style answer without changing SQL routing.

**Architecture:** Keep query intent and serving SQL unchanged. Add a renderer-only branch in `src/query-engine-renderer.ts` that detects broad HQ asks from `planner_meta.normalized_question`, then renders a richer answer from the same ranking rows. Preserve existing short ranking output for explicit narrow asks such as `排名/最高/最低/最危险`.

**Tech Stack:** TypeScript, Vitest, existing serving query plane

---

### Task 1: Lock broad HQ revenue ask behavior with a failing test

**Files:**
- Modify: `src/query-engine.test.ts`
- Test: `src/query-engine.test.ts`

**Step 1: Write the failing test**

Add/modify the existing `5个店近一周的营收情况` test so it expects:
- `5店 近7天 营收总览`
- `营收排名`
- `头尾差`
- `最该关注`
- `下周动作`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/query-engine.test.ts`

Expected: the broad HQ revenue ask test fails because current rendering still returns the short ranking list.

### Task 2: Implement renderer-only broad HQ answer path

**Files:**
- Modify: `src/query-engine-renderer.ts`
- Test: `src/query-engine.test.ts`

**Step 1: Add broad HQ ask detector**

Detect broad asks from `plan.planner_meta.normalized_question`:
- positive signals: `情况|整体|怎么样|如何|总览|全景|重点关注|先抓`
- negative signals: `排名|排行|最高|最低|top|倒数|最危险`

**Step 2: Add broad HQ revenue renderer**

From existing ranking rows derive:
- total revenue
- top and bottom store
- head-tail revenue gap
- focus store = highest risk score row
- reasons = existing `resolveServingRiskReasons`
- action = existing `resolveServingRiskTopAction`

**Step 3: Keep narrow ranking untouched**

Only use the broad renderer for:
- `plan.entity === "hq"`
- `plan.action === "ranking"`
- `metric === "serviceRevenue"`
- broad ask detector returns true

### Task 3: Verify targeted query and non-regression

**Files:**
- Test: `src/query-engine.test.ts`
- Test: `src/sql-compiler.test.ts`

**Step 1: Run targeted tests**

Run: `pnpm exec vitest run src/query-engine.test.ts src/sql-compiler.test.ts`

Expected: PASS

**Step 2: Keep explicit ranking behavior intact**

Ensure existing tests for:
- `五店近7天哪家店最危险`
- explicit ranking asks

still pass without output changes.
