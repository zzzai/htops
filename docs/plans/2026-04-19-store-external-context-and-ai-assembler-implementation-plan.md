# Store External Context And AI Assembler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PostgreSQL-backed store external context storage plus a reusable AI context assembler for confirmed, estimated, and research-note market knowledge.

**Architecture:** Extend `HetangOpsStore` with one normalized table for store external context entries, then add a small owner module that reads the latest snapshot and assembles an AI-safe structured payload. Keep `research_note` separate from hard facts and do not let the new data directly change deterministic scoring.

**Tech Stack:** TypeScript, PostgreSQL via existing store initialization path, Vitest, current Hetang owner-module architecture

---

### Task 1: Lock the storage contract with failing store tests

**Files:**
- Modify: `src/store.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Add a focused store test that:

- asserts `store_external_context_entries` is created by `store.initialize()`
- inserts a mix of `confirmed`, `estimated`, and `research_note`
- lists the latest snapshot for a store and sees the rows grouped by snapshot date

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store external context entries and lists the latest snapshot"`

Expected: FAIL because the table and methods do not exist yet.

**Step 3: Write minimal implementation**

- add types for store external context entries
- add table DDL in `src/store.ts`
- add insert/list methods in `src/store.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store external context entries and lists the latest snapshot"`

Expected: PASS

---

### Task 2: Lock the assembler contract with failing unit tests

**Files:**
- Create: `src/store-external-context.ts`
- Create: `src/store-external-context.test.ts`

**Step 1: Write the failing test**

Add tests that assert the assembler:

- groups `confirmed` into object form
- groups `estimated_market_context` into object form
- keeps `research_note` as note list
- preserves provenance fields
- handles empty input by returning a safe empty structure

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store-external-context.test.ts`

Expected: FAIL because the assembler module does not exist yet.

**Step 3: Write minimal implementation**

- implement the latest-snapshot loader adapter shape
- implement the assembler
- keep the output minimal and typed

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store-external-context.test.ts`

Expected: PASS

---

### Task 3: Add a checked-in JSON snapshot example for the Yingbin external context

**Files:**
- Create: `data/store-external-context/yingbin-2026-04-18.json`

**Step 1: Write the artifact**

Materialize the already-reviewed Yingbin external context into a checked-in JSON snapshot using the new storage shape.

**Step 2: Keep scope bounded**

Do not build an importer script yet unless tests or usage prove it is immediately needed.

---

### Task 4: Run targeted regression verification

**Files:**
- Verify only

**Step 1: Run the focused tests**

Run:

- `pnpm exec vitest run src/store.test.ts -t "persists store external context entries and lists the latest snapshot"`
- `pnpm exec vitest run src/store-external-context.test.ts`

**Step 2: Run a wider regression sweep**

Run:

- `pnpm exec vitest run src/store-query.test.ts src/query-engine-renderer.test.ts src/customer-profile.test.ts src/customer-query.test.ts src/app/reactivation-execution-service.test.ts`

Expected: PASS
