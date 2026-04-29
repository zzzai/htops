# Hetang P0 SQL Buildout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first P0 data-layer upgrades for `hetang-ops` so store quick queries and profile analysis rely on stable SQL surfaces instead of scattered runtime aggregation.

**Architecture:** Keep the existing `PostgreSQL + TypeScript + OpenClaw runtime` architecture, and add a small set of high-value SQL views/materialized views inside the existing store bootstrap. Start with store daily KPI strengthening, tech 30-day profile, and 7-day store review surfaces before moving to customer cohorts and richer profile layers.

**Tech Stack:** PostgreSQL, TypeScript, existing `extensions/hetang-ops/src/store.ts` bootstrap SQL, Vitest.

---

### Task 1: Freeze the P0 SQL surface contract

**Files:**

- Modify: `docs/plans/2026-04-04-hetang-enterprise-metrics-architecture-design.md`
- Create: `docs/plans/2026-04-04-hetang-p0-sql-contract.md`

**Step 1: Write the contract document**

- List exact fields for:
  - `mv_store_manager_daily_kpi`
  - `mv_tech_profile_30d`
  - `mv_store_review_7d`
- For each field, specify:
  - source table
  - source field
  - aggregation rule
  - null behavior

**Step 2: Review against current schema**

Run: `rg -n "fact_consume_bills|fact_tech_up_clock|fact_tech_market|mart_customer_tech_links|mart_daily_store_metrics" extensions/hetang-ops/src/store.ts`

Expected: confirm every planned field has a current source or is explicitly marked as deferred.

**Step 3: Commit**

```bash
scripts/committer "docs: add hetang p0 sql contract" docs/plans/2026-04-04-hetang-enterprise-metrics-architecture-design.md docs/plans/2026-04-04-hetang-p0-sql-contract.md
```

### Task 2: Add failing store-layer tests for new SQL surfaces

**Files:**

- Modify: `extensions/hetang-ops/src/store.test.ts`

**Step 1: Write failing tests**

- Add tests that expect:
  - `listStoreManagerDailyKpiByDateRange` returns the strengthened fields if exposed
  - a new `listTechProfile30dByDateRange` or equivalent accessor exists
  - a new `listStoreReview7dByDateRange` or equivalent accessor exists

**Step 2: Run the scoped tests**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: FAIL because the new SQL surfaces and accessors do not exist yet.

**Step 3: Commit**

```bash
scripts/committer "test: add hetang p0 sql surface coverage" extensions/hetang-ops/src/store.test.ts
```

### Task 3: Strengthen `mv_store_manager_daily_kpi`

**Files:**

- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts`

**Step 1: Add or refresh the materialized view bootstrap SQL**

- Ensure the view includes, at minimum:
  - `biz_date`
  - `org_id`
  - `store_name`
  - `daily_actual_revenue`
  - `daily_card_consume`
  - `daily_order_count`
  - `total_clocks`
  - `assign_clocks`
  - `queue_clocks`
  - `point_clock_rate`
- If safely derivable now, also add:
  - `average_ticket`
  - `clock_effect`

**Step 2: Update the accessor mapping**

- Keep `listStoreManagerDailyKpiByDateRange` aligned with the view columns.

**Step 3: Run scoped tests**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: PASS for the daily KPI view-related assertions.

**Step 4: Commit**

```bash
scripts/committer "feat: strengthen hetang daily kpi view" extensions/hetang-ops/src/store.ts extensions/hetang-ops/src/store.test.ts
```

### Task 4: Add `mv_tech_profile_30d`

**Files:**

- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts`

**Step 1: Add the materialized view bootstrap SQL**

- Build a 30-day rolling tech profile based on:
  - `fact_tech_up_clock`
  - `fact_tech_market`
  - `mart_customer_tech_links`

- Include fields:
  - `org_id`
  - `window_end_biz_date`
  - `tech_code`
  - `tech_name`
  - `served_customer_count_30d`
  - `served_order_count_30d`
  - `service_day_count_30d`
  - `total_clock_count_30d`
  - `point_clock_rate_30d`
  - `add_clock_rate_30d`
  - `turnover_30d`
  - `commission_30d`
  - `market_revenue_30d`

**Step 2: Add a typed accessor**

- Add a store method that fetches this view by `org_id` and `window_end_biz_date`.

**Step 3: Add test coverage**

- Verify the accessor returns numeric fields correctly normalized.

**Step 4: Run scoped tests**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: PASS for the new tech profile assertions.

**Step 5: Commit**

```bash
scripts/committer "feat: add hetang tech profile 30d view" extensions/hetang-ops/src/store.ts extensions/hetang-ops/src/types.ts extensions/hetang-ops/src/store.test.ts
```

### Task 5: Add `mv_store_review_7d`

**Files:**

- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts`

**Step 1: Add the materialized view bootstrap SQL**

- Build a 7-day review surface combining:
  - `mart_daily_store_metrics`
  - `mv_store_manager_daily_kpi`
  - stable store-level aggregates already computed by the project

- Include fields:
  - `org_id`
  - `window_end_biz_date`
  - `revenue_7d`
  - `order_count_7d`
  - `total_clocks_7d`
  - `clock_effect_7d`
  - `average_ticket_7d`
  - `point_clock_rate_7d`
  - `add_clock_rate_7d`
  - `groupbuy_order_share_7d`
  - `groupbuy_7d_revisit_rate`
  - `groupbuy_7d_card_open_rate`
  - `groupbuy_7d_stored_value_conversion_rate`
  - `groupbuy_30d_member_pay_conversion_rate`
  - `sleeping_member_rate`
  - `active_tech_count_7d`

**Step 2: Add a typed accessor**

- Add a store method that returns rows for the requested store and end date.

**Step 3: Add test coverage**

- Verify missing values remain null where expected, and normalized numbers remain safe.

**Step 4: Run scoped tests**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: PASS for the 7-day review assertions.

**Step 5: Commit**

```bash
scripts/committer "feat: add hetang store review 7d view" extensions/hetang-ops/src/store.ts extensions/hetang-ops/src/types.ts extensions/hetang-ops/src/store.test.ts
```

### Task 6: Wire the new SQL surfaces into query consumers

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.ts`
- Modify: `extensions/hetang-ops/src/tech-profile.ts`
- Modify: `extensions/hetang-ops/src/customer-profile.ts`
- Modify: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Replace fragile runtime aggregation where the new views cover it**

- Use `mv_tech_profile_30d` for tech 30-day summary questions.
- Use `mv_store_review_7d` for standard 7-day store review questions.

**Step 2: Keep fallbacks**

- If the view returns no rows, preserve current fallback behavior rather than hard-failing.

**Step 3: Add tests**

- Verify queries now render stable fields from the new SQL surfaces.

**Step 4: Run scoped tests**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
scripts/committer "feat: use p0 hetang sql surfaces in query paths" extensions/hetang-ops/src/query-engine.ts extensions/hetang-ops/src/tech-profile.ts extensions/hetang-ops/src/customer-profile.ts extensions/hetang-ops/src/query-engine.test.ts
```

### Task 7: Verify the P0 buildout end-to-end

**Files:**

- No extra file changes unless verification finds a defect.

**Step 1: Run focused store and query tests**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts extensions/hetang-ops/src/query-engine.test.ts extensions/hetang-ops/src/tech-profile.test.ts extensions/hetang-ops/src/customer-profile.test.ts`

Expected: PASS.

**Step 2: Run runtime-adjacent tests**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts extensions/hetang-ops/src/inbound.test.ts`

Expected: PASS.

**Step 3: Run build**

Run: `pnpm build`

Expected: PASS.

**Step 4: Summarize**

- Report which questions now hit stable SQL surfaces
- Report which metrics still come from `metrics_json`
- Report which P1 dependencies remain, especially `mart_customer_conversion_cohorts`
