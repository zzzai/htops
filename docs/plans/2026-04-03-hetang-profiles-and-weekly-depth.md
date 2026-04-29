# Hetang Profiles And Weekly Depth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deepen customer profiles, technician profiles, and weekly operating diagnosis so outputs feel like real store review material instead of thin metric summaries.

**Architecture:** Reuse the existing deterministic query path instead of creating a parallel analysis subsystem. Enrich the existing customer profile, tech profile, and range-report rendering with operator-facing summary blocks, comparative breakdowns, and explicit data-availability disclosure for tea/meal signals when upstream raw data is absent.

**Tech Stack:** TypeScript, Vitest, `extensions/hetang-ops/src/query-engine.ts`, `extensions/hetang-ops/src/customer-profile.ts`, `extensions/hetang-ops/src/tech-profile.ts`

---

### Task 1: Add Failing Tests For Deeper Customer Profile Output

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.test.ts`
- Test: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Write the failing test**

Add customer-profile assertions that require:

- summary output to include recent 30/90 day cadence and value judgment
- payment structure insight beyond the basic list
- explicit `茶饮偏好` / `餐食偏好` fallback text when no recognizable detail exists
- clearer distinction between service project preferences and addon preferences

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "customer profile"`

Expected: FAIL because the current profile output is missing the deeper blocks and explicit fallback wording.

**Step 3: Write minimal implementation**

Modify `extensions/hetang-ops/src/customer-profile.ts` so the summary profile includes:

- a concise business summary block
- 30/90 day visit and payment rhythm
- payment structure diagnosis
- explicit tea/meal/addon disclosure even when raw records are absent

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "customer profile"`

Expected: PASS.

### Task 2: Add Failing Tests For Deeper Tech Profile Output

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.test.ts`
- Test: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Write the failing test**

Add technician-profile assertions that require:

- 30 day real service customer count when coverage is ready
- repeat-customer count and important-member coverage
- stronger business diagnosis wording around point-clock / add-clock / commission / market penetration
- clearer store-manager action framing

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "技师"`

Expected: FAIL because the current profile text does not include the deeper operating fields.

**Step 3: Write minimal implementation**

Modify `extensions/hetang-ops/src/tech-profile.ts` to add:

- richer customer coverage summary
- repeat customer and high-value member stats
- more explicit strengths, weaknesses, and queueing/training suggestions

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "技师"`

Expected: PASS.

### Task 3: Add Failing Tests For Richer Weekly Diagnosis

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.test.ts`
- Test: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Write the failing test**

Extend weekly-review assertions so the report must include:

- current-week vs previous-week comparison
- weekday vs weekend split
- member-side problem list
- technician-side problem list
- three must-do actions for the current week

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "weekly store reviews"`

Expected: FAIL because current weekly review output is still missing those sections.

**Step 3: Write minimal implementation**

Modify `extensions/hetang-ops/src/query-engine.ts` to:

- derive a previous comparable range for range-style operating reviews
- compute weekday/weekend split from the same report window
- render a more complete weekly diagnosis structure

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "weekly store reviews"`

Expected: PASS.

### Task 4: Verification Sweep

**Files:**

- Verify only

**Step 1: Run targeted query-engine verification**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts`

Expected: PASS.

**Step 2: Run touched Hetang verification**

Run: `pnpm test -- extensions/hetang-ops/src/inbound.test.ts extensions/hetang-ops/src/runtime.test.ts extensions/hetang-ops/src/cli.test.ts`

Expected: PASS.

**Step 3: Run build**

Run: `pnpm build`

Expected: exit 0.
