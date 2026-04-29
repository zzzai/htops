# Hetang Runtime Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the Hetang main chain so scheduler failures are observable, midday brief delivery is per-store idempotent, midday headlines use the shared business judgment, and inbound routing is less brittle for new business asks.

**Architecture:** Reuse the existing `scheduled_job_state` persistence path instead of adding a heavy new subsystem. Keep the fast SQL-first path intact, but add a lightweight semantic normalization layer ahead of the existing rule router so new phrasings map into the same supported intent surface more reliably.

**Tech Stack:** TypeScript, Vitest, PostgreSQL-backed `HetangOpsStore`, OpenClaw plugin runtime

---

### Task 1: Poller observability

**Files:**
- Modify: `extensions/hetang-ops/src/service.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/service.test.ts`

**Steps:**
1. Add a failing service test that proves scheduled and analysis poller failures are logged and recorded instead of swallowed.
2. Implement a small runtime-facing poller status recorder using existing scheduled job state storage.
3. Update the service loop to log success/failure summaries and persist last-run failure state.
4. Re-run the scoped service tests.

### Task 2: Midday per-store idempotency

**Files:**
- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/runtime.test.ts`

**Steps:**
1. Add a failing runtime test showing partial midday send failure causes duplicate re-sends today.
2. Persist per-run-key per-store midday delivery state in `scheduled_job_state`.
3. Skip already delivered stores on retry and mark the whole scheduled job complete only when all active stores are delivered.
4. Re-run the scoped runtime tests.

### Task 3: Unified midday headline

**Files:**
- Modify: `extensions/hetang-ops/src/report.ts`
- Modify: `extensions/hetang-ops/src/report.test.ts`

**Steps:**
1. Add a failing report test proving the midday headline should reflect the shared store business score rather than a second threshold stack.
2. Replace the bespoke headline resolver with the shared judgment signal plus concise tag selection.
3. Re-run the scoped report tests.

### Task 4: Metric semantics plus rule routing plus fallback

**Files:**
- Modify: `extensions/hetang-ops/src/query-intent.ts`
- Modify: `extensions/hetang-ops/src/inbound.ts`
- Modify: `extensions/hetang-ops/src/query-intent.test.ts`
- Modify: `extensions/hetang-ops/src/inbound.test.ts`

**Steps:**
1. Add failing tests for new-but-equivalent manager phrasings that should map into existing supported intents.
2. Introduce a small semantic normalization layer for core metric/business nouns before the existing rule routing runs.
3. Keep unsupported capability replies and fallback guidance deterministic.
4. Re-run the scoped inbound and query-intent tests.

### Task 5: Verification

**Files:**
- No code changes required

**Steps:**
1. Run all touched scoped tests again.
2. If the touched surfaces plausibly affect build output, run `pnpm build`.
3. Summarize remaining risk honestly, especially around data quality vs. routing quality.
