# Hetang Store Midday Brief Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the store-manager midday brief into a five-section operating brief that uses daily, 7-day, and 30-day surfaces without ever showing `N/A`.

**Architecture:** Keep the existing `DailyStoreReport` build flow unchanged. Enrich only the midday-send path by pulling `mv_store_review_7d` and `mv_store_summary_30d` on demand, then render a deterministic five-section brief with strict hide-on-missing rules.

**Tech Stack:** TypeScript, Vitest, PostgreSQL materialized views, existing `hetang-ops` runtime and report renderer.

---

### Task 1: Lock the new midday brief contract with failing tests

**Files:**
- Create: `extensions/hetang-ops/src/report.test.ts`
- Modify: `extensions/hetang-ops/src/runtime.test.ts`

**Step 1: Write the failing report renderer test**

Cover:

- the new five-section structure
- no `现金池`
- no `N/A`
- hide the 30-day block when summary data is absent

**Step 2: Write the failing runtime send test**

Cover:

- runtime fetches 7-day and 30-day windows
- the sent message contains new section titles
- the sent message no longer contains `现金池`

**Step 3: Run tests to verify they fail**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/report.test.ts extensions/hetang-ops/src/runtime.test.ts
```

Expected: FAIL because the current renderer still uses the old midday brief structure.

### Task 2: Implement the redesigned midday renderer

**Files:**
- Modify: `extensions/hetang-ops/src/report.ts`

**Step 1: Add a dedicated midday input model**

Include:

- `report`
- current/previous 7-day rows
- current/previous 30-day rows

**Step 2: Replace the old midday template**

Render:

1. `一句话判断`
2. `昨日收盘`
3. `近7天变化`
4. `近30天会员与储值风险`
5. `今日先抓`

**Step 3: Enforce hide-on-missing behavior**

- no `N/A`
- hide missing metrics
- hide whole section if the section has no reliable lines

**Step 4: Run the focused report test**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/report.test.ts
```

Expected: PASS.

### Task 3: Wire stable 7-day and 30-day windows into midday sending

**Files:**
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1: Add safe on-demand lookup helpers**

Read:

- current and previous `mv_store_review_7d` rows
- current and previous `mv_store_summary_30d` rows

If a stable view is unavailable, log and degrade instead of failing the brief.

**Step 2: Pass the new context into `renderStoreMiddayBrief()`**

Keep daily report caching behavior unchanged.

**Step 3: Run the focused runtime test**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "sends one concise noon operating brief per store after the long-form report already ran"
```

Expected: PASS.

### Task 4: Verify the Hetang midday path and send a real validation message

**Files:**
- No additional production files expected

**Step 1: Run targeted verification**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/report.test.ts extensions/hetang-ops/src/runtime.test.ts
pnpm build
```

Expected: PASS.

**Step 2: Generate one real midday brief**

Use runtime-backed generation for the validation store/date.

**Step 3: Deliver to ZhangZhen**

Send the generated message to `wecom:ZhangZhen` using `openclaw message send`.
