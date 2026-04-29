# Yingbin Reactivation Execution Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a daily, actionable reactivation execution layer for Yingbin so recall questions, follow-up lists, and future operational feedback all read from one stable queue instead of ad-hoc customer-segment heuristics.

**Architecture:** Keep the current `fact -> mart -> serving` path. Continue using `mart_member_reactivation_features_daily` and `mart_member_reactivation_strategies_daily` as the modeling layer, then add a new daily execution mart that converts raw recall scores into relative priority bands, produces operator-ready reasons and contact windows, and exposes a serving surface for queries and future push jobs.

**Tech Stack:** Node.js, TypeScript, PostgreSQL, pg-mem, Vitest

---

## Scope

- Yingbin-first, but implemented generically per `org_id`
- No AI-written SQL
- No external feedback system dependency
- No new model training step
- No change to upstream ingestion

## Chosen Approach

### Option A: Keep using `mart_customer_segments` heuristics only

- Pros: no schema work, fastest short-term patch
- Cons: cannot explain "why now", cannot normalize recall scores, cannot accumulate execution feedback

### Option B: Add one dedicated reactivation execution mart and one lightweight feedback table

- Pros: stable daily queue, clear operator reason strings, future-proof for push and service APIs, clean query integration
- Cons: adds a small amount of schema and rebuild code

### Option C: Replace the whole customer serving plane with recall-only serving

- Pros: most opinionated
- Cons: over-corrects, creates parallel logic, unnecessary for the current project

**Recommendation:** Option B. It is the smallest change that turns the current recall model into an executable operating layer.

## Data Model

### New mart: `mart_member_reactivation_queue_daily`

One row per `org_id + biz_date + member_id`.

Core fields:

- identity: `org_id`, `biz_date`, `member_id`, `customer_identity_key`, `customer_display_name`, `member_card_no`, `reference_code`
- business context: `primary_segment`, `recommended_action_label`, `churn_risk_label`, `revisit_window_label`
- execution priority: `reactivation_priority_score`, `strategy_priority_score`, `priority_band`, `priority_rank`
- operator explanation: `reason_summary`, `touch_advice_summary`
- action hints: `recommended_touch_weekday`, `recommended_touch_daypart`, `touch_window_label`
- customer facts: `days_since_last_visit`, `visit_count_90d`, `pay_amount_90d`, `current_stored_balance_inferred`, `projected_balance_days_left`, `top_tech_name`
- payload: `queue_json`, `updated_at`

### New ops table: `ops_member_reactivation_feedback`

Minimal execution feedback, append/update by day and member.

Core fields:

- `org_id`, `biz_date`, `member_id`
- `feedback_status`
- `followed_by`
- `followed_at`
- `contacted`
- `replied`
- `booked`
- `arrived`
- `note`
- `updated_at`

## Priority Banding Rules

Use relative same-day same-store ranking, not absolute thresholds.

- `P0`: top urgent execution band
- `P1`: high priority this week
- `P2`: nurture / scheduled follow-up
- `P3`: observe only

Band assignment should be deterministic from daily ranking percentile so stores with different score ranges still produce usable action buckets.

## Serving Strategy

Do not replace the existing customer serving surfaces.

Instead:

- keep `serving_customer_profile_asof` and `serving_customer_ranked_list_asof`
- add a new serving surface backed by the new mart for recall execution
- update customer follow-up queries to prefer the recall queue when available
- keep the old heuristic renderer as fallback

## Query Behavior Target

Questions such as:

- “迎宾店今天最该跟进的30个顾客是谁”
- “迎宾店高价值待唤回名单”
- “迎宾店现在该几点联系这些人”

should return rows from the new queue with:

- relative priority band
- clear reason summary
- recommended touch window
- top tech / stored-value context when available

## Error Handling

- Missing queue rows: fall back to current customer-segment follow-up logic
- Missing feedback rows: treat as not-followed-up
- Missing feature or strategy rows for a day: queue rebuild for that day yields zero rows and does not fail the whole range

## Testing Strategy

- Unit test queue banding and ranking
- Store persistence test for queue rows and feedback rows
- Query-engine test that follow-up asks prefer the new queue surface
- Runtime test that queue rebuild is included after features and strategies during customer history rebuild

### Task 1: Add the failing queue-builder tests

**Files:**
- Create: `src/reactivation-queue.test.ts`
- Modify: `src/types.ts`
- Test: `src/reactivation-queue.test.ts`

**Step 1: Write the failing test**

Cover:

- percentile banding into `P0/P1/P2/P3`
- reason summary generation
- touch advice generation
- ordering by strategy score and band

**Step 2: Run test to verify it fails**

Run: `npm test -- src/reactivation-queue.test.ts`
Expected: FAIL because the queue builder and related types do not exist yet.

**Step 3: Write minimal implementation**

Create `src/reactivation-queue.ts` with a deterministic daily builder that joins feature and strategy rows and emits queue records.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/reactivation-queue.test.ts`
Expected: PASS

**Step 5: Commit**

If git is available, commit the queue builder and tests. If this workspace is not a git checkout, skip commit and continue.

### Task 2: Add failing store persistence tests

**Files:**
- Modify: `src/store.test.ts`
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

Cover:

- `replaceMemberReactivationQueue`
- `listMemberReactivationQueue`
- `upsertMemberReactivationFeedback`
- `listMemberReactivationFeedback`

**Step 2: Run test to verify it fails**

Run: `npm test -- src/store.test.ts`
Expected: FAIL because the tables and methods do not exist yet.

**Step 3: Write minimal implementation**

Add schema, indexes, row mappers, replace/list/upsert methods.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/store.test.ts`
Expected: PASS

**Step 5: Commit**

If git is available, commit the persistence layer changes. Otherwise continue.

### Task 3: Add failing runtime rebuild tests

**Files:**
- Modify: `src/runtime.test.ts`
- Modify: `src/runtime.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write the failing test**

Cover:

- queue rebuild runs after feature and strategy rebuilds
- runtime exposes queue and feedback list methods

**Step 2: Run test to verify it fails**

Run: `npm test -- src/runtime.test.ts`
Expected: FAIL because queue rebuild is not wired into runtime yet.

**Step 3: Write minimal implementation**

Import queue rebuilder and call it in customer history catchup after strategy rebuild.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/runtime.test.ts`
Expected: PASS

**Step 5: Commit**

If git is available, commit runtime integration changes. Otherwise continue.

### Task 4: Add failing query integration tests

**Files:**
- Modify: `src/query-engine.test.ts`
- Modify: `src/customer-query.ts`
- Modify: `src/query-engine.ts`
- Modify: `src/reactivation-push.ts`
- Test: `src/query-engine.test.ts`

**Step 1: Write the failing test**

Cover:

- follow-up asks prefer the reactivation queue when runtime exposes it
- returned text includes priority band, reason, and touch suggestion
- bucket asks still work for high-value reactivation / growth / groupbuy

**Step 2: Run test to verify it fails**

Run: `npm test -- src/query-engine.test.ts`
Expected: FAIL because follow-up rendering still uses the old heuristic-only path.

**Step 3: Write minimal implementation**

Read queue rows in customer-query and reactivation-push, with old logic as fallback.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/query-engine.test.ts`
Expected: PASS

**Step 5: Commit**

If git is available, commit query integration changes. Otherwise continue.

### Task 5: Full targeted verification

**Files:**
- Modify: `src/reactivation-queue.ts`
- Modify: `src/store.ts`
- Modify: `src/runtime.ts`
- Modify: `src/customer-query.ts`
- Modify: `src/reactivation-push.ts`

**Step 1: Run focused test suite**

Run:

```bash
npm test -- src/reactivation-queue.test.ts src/store.test.ts src/runtime.test.ts src/query-engine.test.ts
```

Expected: PASS

**Step 2: Run broader regression slice**

Run:

```bash
npm test -- src/reactivation-features.test.ts src/reactivation-strategy.test.ts src/reactivation-push.test.ts
```

Expected: PASS

**Step 3: Publish serving note**

If runtime path is used in production, write a short note into the final summary listing the new queue surface and the fallback behavior.

**Step 4: Commit**

If git is available, commit the completed execution layer. Otherwise document that the workspace is not a git checkout.
