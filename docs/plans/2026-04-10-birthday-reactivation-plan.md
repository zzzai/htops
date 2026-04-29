# Birthday Reactivation Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add birthday as a first-class recall execution signal so birthday-member questions and daily recall execution both run on the same queue.

**Architecture:** Rebuild `mart_member_reactivation_queue_daily` from feature rows, strategy rows, and member daily snapshots. Keep the original strategy score, add a final execution score with a modest birthday boost, then let birthday queries reuse queue ordering whenever possible.

**Tech Stack:** Node.js, TypeScript, PostgreSQL, pg-mem, Vitest

---

### Task 1: Write failing queue birthday tests

**Files:**
- Modify: `src/reactivation-queue.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Add one test where two otherwise similar members differ only by upcoming birthday and confirm the birthday member gets the higher queue rank.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/reactivation-queue.test.ts`

Expected: FAIL because queue rows do not expose birthday fields or birthday-aware execution sorting yet.

**Step 3: Write minimal implementation**

Add birthday-aware queue scoring and fields.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/reactivation-queue.test.ts`

Expected: PASS

### Task 2: Write failing persistence test

**Files:**
- Modify: `src/store.test.ts`
- Modify: `src/store.ts`

**Step 1: Write the failing test**

Extend the existing queue persistence test to assert birthday fields and execution score are stored and read back.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/store.test.ts`

Expected: FAIL because the table schema and row mappers do not include the new fields.

**Step 3: Write minimal implementation**

Add table columns, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, insert bindings, and row mapping.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/store.test.ts`

Expected: PASS

### Task 3: Write failing birthday query integration test

**Files:**
- Modify: `src/query-engine.test.ts`
- Modify: `src/birthday-query.ts`
- Modify: `src/query-engine.ts`

**Step 1: Write the failing test**

Add a test where birthday candidates exist and queue ranking should beat the old ad-hoc stored-balance sorting.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/query-engine.test.ts`

Expected: FAIL because birthday queries do not read queue ordering yet.

**Step 3: Write minimal implementation**

Add queue snapshot loading into birthday query execution and use queue ranking first, with fallback to old behavior.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/query-engine.test.ts`

Expected: PASS

### Task 4: Refactor shared birthday parsing

**Files:**
- Create: `src/birthday-utils.ts`
- Modify: `src/birthday-query.ts`
- Modify: `src/reactivation-queue.ts`

**Step 1: Write the failing test**

Use existing failing tests from Tasks 1 and 3 as the driver.

**Step 2: Run focused tests**

Run: `npm test -- src/reactivation-queue.test.ts src/query-engine.test.ts`

Expected: at least one FAIL before utility extraction is complete.

**Step 3: Write minimal implementation**

Extract shared birthday parsing and next-birthday resolution helpers so the queue builder and birthday query use one source of truth.

**Step 4: Run focused tests**

Run: `npm test -- src/reactivation-queue.test.ts src/query-engine.test.ts`

Expected: PASS

### Task 5: Full verification

**Files:**
- Modify only files touched above

**Step 1: Run focused regression suite**

Run: `npm test -- src/reactivation-queue.test.ts src/store.test.ts src/query-engine.test.ts`

Expected: PASS

**Step 2: Run broader related suite**

Run: `npm test -- src/runtime.test.ts src/customer-query.test.ts src/reactivation-features.test.ts src/reactivation-strategy.test.ts`

Expected: PASS or no new failures related to birthday queue integration.

**Step 3: Document any non-git limitation**

If the workspace is not a git checkout, skip commit and report that limitation explicitly.
