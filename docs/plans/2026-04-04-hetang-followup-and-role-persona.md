# Hetang Follow-Up And Role Persona Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split customer follow-up output into three actionable buckets and make Hetang's self-introduction role-adaptive for HQ versus store users.

**Architecture:** Keep the existing `hetang-ops` natural-language claim flow. Extend `customer-query.ts` to render grouped follow-up sections from the existing customer segment snapshot, and add a lightweight identity-question interceptor in `inbound.ts` so “你是谁” style asks no longer fall through to the generic assistant path.

**Tech Stack:** TypeScript, Vitest, existing `hetang-ops` inbound routing and query execution pipeline.

---

### Task 1: Add failing tests for grouped follow-up output

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Write the failing test**

- Update the existing “最值得跟进的顾客” test to expect:
  - `高价值待唤回`
  - `潜力成长`
  - `团购留存`
- Stop expecting a single mixed “跟进优先顾客” list.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "returns grouped follow-up customer buckets"`

Expected: FAIL because the current renderer still returns one mixed list.

### Task 2: Add failing tests for role-adaptive identity replies

**Files:**

- Modify: `extensions/hetang-ops/src/inbound.test.ts`

**Step 1: Write the failing tests**

- Add one test for an HQ-bound user asking `你是谁`.
- Add one test for a single-store manager asking `你是谁`.
- Expect both messages to be handled by `hetang-ops`, but with different role descriptions.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/inbound.test.ts -t "who are you"`

Expected: FAIL because these messages are not currently claimed by `hetang-ops`.

### Task 3: Implement grouped follow-up rendering

**Files:**

- Modify: `extensions/hetang-ops/src/customer-query.ts`

**Step 1: Keep the existing candidate filter and scoring**

- Reuse current candidate eligibility logic so behavior stays stable.

**Step 2: Group output into three buckets**

- Build grouped sections for:
  - `高价值待唤回`
  - `潜力成长`
  - `团购留存`
- Keep per-group priority ordering.
- Hide empty groups.

**Step 3: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "returns grouped follow-up customer buckets"`

Expected: PASS.

### Task 4: Implement role-adaptive identity claiming

**Files:**

- Modify: `extensions/hetang-ops/src/inbound.ts`

**Step 1: Add identity-question recognition**

- Match short asks such as:
  - `你是谁`
  - `你是干嘛的`
  - `你能做什么`
  - `你是什么角色`

**Step 2: Add role-adaptive reply builder**

- HQ users get “总部经营副驾 / 连锁经营参谋” wording.
- Single-store managers get “门店经营参谋 / 店长副驾” wording.
- Avoid “AI 总经办”.

**Step 3: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/inbound.test.ts -t "who are you"`

Expected: PASS.

### Task 5: Verify adjacent surfaces

**Files:**

- No extra changes unless verification exposes a regression.

**Step 1: Run scoped tests**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts extensions/hetang-ops/src/inbound.test.ts extensions/hetang-ops/src/query-intent.test.ts`

**Step 2: Run build**

Run: `pnpm build`

**Step 3: Smoke-check channel config**

Run: `pnpm openclaw channels status --probe`

Expected: build passes and WeCom remains enabled/configured/running.
