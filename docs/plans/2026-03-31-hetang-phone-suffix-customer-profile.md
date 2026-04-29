# Hetang Phone-Suffix Customer Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a secure WeCom natural-language query flow where managers and HQ can enter a customer's phone suffix and receive a masked, field-backed customer profile with technician, project, payment, visit-habit, and add-on preferences.

**Architecture:** Extend the existing Hetang deterministic query pipeline with a new phone-suffix profile intent, then build a dedicated customer-profile aggregation layer backed by PostgreSQL facts and marts. Upgrade `fact_tech_market` to persist `SettleNo` and related sales metadata so add-on items can be joined to the same customer order and included in the profile.

**Tech Stack:** TypeScript, Vitest, PostgreSQL, existing Hetang sync/runtime/query pipeline.

---

### Task 1: Lock the feature with failing tests

**Files:**

- Modify: `extensions/hetang-ops/src/query-intent.test.ts`
- Modify: `extensions/hetang-ops/src/inbound.test.ts`
- Modify: `extensions/hetang-ops/src/query-engine.test.ts`
- Modify: `extensions/hetang-ops/src/normalize.test.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts` or `extensions/hetang-ops/src/sync-and-report.test.ts`

**Step 1: Write failing intent tests**

Add tests for:

- `义乌店尾号7500客户画像`
- `尾号7500最近喜欢哪个技师`
- `尾号7500常做什么项目`
- `尾号7500常买什么茶饮`

Expected:

- intent kind resolves to a dedicated sensitive customer profile intent
- time window defaults to report day, with explicit `近30天/近90天` support

**Step 2: Run the intent test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/query-intent.test.ts`
Expected: FAIL because the new intent does not exist yet.

**Step 3: Write failing execution tests**

In `query-engine.test.ts`, add cases for:

- unique phone suffix hit returns masked profile
- multiple suffix hits returns candidate list
- no hit returns safe not-found message
- profile includes preferred technician, preferred projects, payment mix, visit habit, and add-on preferences

**Step 4: Write failing tech-market persistence tests**

Add tests proving `1.7` rows preserve:

- `SettleNo`
- `HandCardCode`
- `RoomCode`
- `ItemTypeName`
- `ItemCategory`
- `SalesCode`
- `SalesName`

And prove store round-trip reads the new fields back out.

**Step 5: Run the targeted tests to verify they fail**

Run:

- `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts`
- `pnpm test -- extensions/hetang-ops/src/normalize.test.ts`
- `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: FAIL with missing intent, missing fields, and missing profile rendering.

### Task 2: Extend the data model for add-on preference joining

**Files:**

- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/normalize.ts`
- Modify: `extensions/hetang-ops/src/store.ts`

**Step 1: Extend `TechMarketRecord`**

Add:

- `settleNo?: string`
- `handCardCode?: string`
- `roomCode?: string`
- `itemTypeName?: string`
- `itemCategory?: number`
- `salesCode?: string`
- `salesName?: string`

**Step 2: Persist the new `1.7` fields**

Update `normalizeTechMarketRow()` to parse the fields from raw API rows.

**Step 3: Update PostgreSQL schema and mappers**

Extend `fact_tech_market` schema and the upsert/select paths so the new fields round-trip correctly.

**Step 4: Run normalization/store tests**

Run:

- `pnpm test -- extensions/hetang-ops/src/normalize.test.ts`
- `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: PASS after minimal implementation.

### Task 3: Add phone-suffix lookup and customer-profile aggregation

**Files:**

- Create: `extensions/hetang-ops/src/customer-profile.ts`
- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1: Add store lookup helpers**

Add helpers for:

- exact suffix lookup on `fact_member_current.phone`
- loading current member cards
- loading consume bills by date range
- loading tech up-clock by date range
- loading tech market by date range

**Step 2: Create the profile aggregator**

Implement a deterministic aggregator that:

- resolves one or more members by tail digits
- maps member/card identity to consume orders
- joins service records via `SettleNo`
- joins add-on sales via `SettleNo`
- computes top technicians, top projects, top add-ons, payment mix, visit windows, and risk tags

**Step 3: Implement ambiguity handling**

If the suffix matches:

- `0` members: return not found
- `1` member: return profile
- `2-5` members: return masked candidate list
- `>5` members: require a store or more context

**Step 4: Run targeted profile tests**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts`
Expected: still FAIL until query wiring is added.

### Task 4: Wire the new intent into the WeCom query flow

**Files:**

- Modify: `extensions/hetang-ops/src/query-intent.ts`
- Modify: `extensions/hetang-ops/src/query-engine.ts`
- Modify: `extensions/hetang-ops/src/inbound.ts` if needed

**Step 1: Add a dedicated profile intent**

Introduce a new intent kind for phone-suffix customer profile queries.

**Step 2: Route execution**

Wire the new intent into `executeHetangQuery()` using the new profile aggregator.

**Step 3: Keep existing metric queries safe**

Ensure tail-profile keywords do not steal:

- `沉默会员`
- `活跃技师`
- other existing deterministic metric phrases

**Step 4: Run query tests**

Run:

- `pnpm test -- extensions/hetang-ops/src/query-intent.test.ts`
- `pnpm test -- extensions/hetang-ops/src/inbound.test.ts`
- `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts`

Expected: PASS.

### Task 5: Full verification and cleanup

**Files:**

- Modify only if test cleanup is needed

**Step 1: Run the Hetang suite**

Run: `pnpm test -- extensions/hetang-ops/src/*.test.ts`
Expected: PASS

**Step 2: Run the build**

Run: `pnpm build`
Expected: PASS

**Step 3: Review final behavior**

Spot-check these final user flows:

- `义乌店尾号7500客户画像`
- `尾号7500最近喜欢哪个技师`
- `尾号7500常做什么项目`
- `尾号7500常买什么茶饮`

**Step 4: Commit**

Use `scripts/committer` with only the touched Hetang files.
