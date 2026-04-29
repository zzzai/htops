# Hetang Sync And Analysis Depth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `hetang-ops` keep pulling the previous business day from the API every day, add a slow/stable February 2026 backfill path, and deepen weekly/business analysis so answers look more like an operator review deck than a thin metric dump.

**Architecture:** Reuse the existing `runtime -> schedule -> sync` chain for daily work, instead of inventing a separate sync runner. Extend runtime scheduling with an explicit controlled backfill job path and enrich the existing weekly/report analysis outputs plus CrewAI sidecar prompt context so “deep analysis” produces funnel-aware, operator-friendly conclusions.

**Tech Stack:** TypeScript, Vitest, existing `hetang-ops` runtime/store/schedule modules, local CrewAI sidecar in `tools/crewai-sidecar`.

---

### Task 1: Add February Backfill And Daily Sync Coverage Tests

**Files:**

- Modify: `extensions/hetang-ops/src/runtime.test.ts`
- Modify: `extensions/hetang-ops/src/schedule.test.ts`
- Test: `extensions/hetang-ops/src/runtime.test.ts`
- Test: `extensions/hetang-ops/src/schedule.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:

- `runDueJobs()` still syncs the previous daily window without widening scope.
- runtime exposes a stable February backfill flow for `2026-02-01..2026-02-28`.
- February backfill stays single-store serial and seven-day chunked.

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts extensions/hetang-ops/src/schedule.test.ts`

Expected: failures showing the February-specific orchestration/helper does not exist yet.

**Step 3: Write the minimal implementation**

Modify runtime/schedule code so:

- daily scheduled sync behavior remains unchanged and explicit.
- a reusable runtime helper can run the fixed February 2026 backfill in week chunks.
- the helper uses existing `backfillStores()` pacing and audit semantics.

**Step 4: Run tests to verify they pass**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts extensions/hetang-ops/src/schedule.test.ts`

Expected: PASS.

### Task 2: Add CLI / Runtime Entry Point For Slow February Backfill

**Files:**

- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/cli.ts`
- Test: `extensions/hetang-ops/src/runtime.test.ts`

**Step 1: Write the failing test**

Add a runtime test for a convenience method or command path that runs the fixed February backfill over all stores using existing pacing.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "February"`

Expected: FAIL because the dedicated helper/command does not exist.

**Step 3: Write minimal implementation**

Add:

- a runtime helper for the fixed February 2026 backfill.
- a CLI command path that operators can run directly without manually retyping the date range every time.

Keep it boring and safe:

- all stores by default
- optional single-store override
- no parallelization

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts -t "February"`

Expected: PASS.

### Task 3: Deepen Weekly Report / Query Output

**Files:**

- Modify: `extensions/hetang-ops/src/query-engine.ts`
- Modify: `extensions/hetang-ops/src/query-engine.test.ts`
- Modify: `extensions/hetang-ops/src/analysis-router.ts`
- Modify: `extensions/hetang-ops/src/inbound.ts`

**Step 1: Write the failing tests**

Add/extend tests that require weekly analysis answers to include:

- a conclusion summary
- funnel diagnosis using the five boss-facing metrics
- membership / technician / groupbuy operating guidance
- progress-first reply copy for long-running analysis asks

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts extensions/hetang-ops/src/inbound.test.ts`

Expected: FAIL because current replies are too shallow or missing the richer structure.

**Step 3: Write minimal implementation**

Update:

- weekly window report rendering to produce a richer, structured review.
- inbound async analysis acknowledgement text so users get a short “working on it” response.
- analysis routing to prefer deep-analysis mode for weekly diagnosis asks consistently.

**Step 4: Run tests to verify they pass**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts extensions/hetang-ops/src/inbound.test.ts`

Expected: PASS.

### Task 4: Deepen CrewAI Sidecar Prompting For Business Review

**Files:**

- Modify: `tools/crewai-sidecar/prompting.py`
- Modify: `tools/crewai-sidecar/tests/test_prompting.py`
- Modify: `tools/crewai-sidecar/tests/test_store_review.py`

**Step 1: Write the failing tests**

Require the prompt bundle/context to explicitly include:

- the new five groupbuy/member funnel metrics
- stronger operator output structure
- advice framed around people, actions, and expected metric movement

**Step 2: Run tests to verify they fail**

Run: `cd tools/crewai-sidecar && python -m pytest tests/test_prompting.py tests/test_store_review.py`

Expected: FAIL because current prompt bundle does not enforce the richer business framing strongly enough.

**Step 3: Write minimal implementation**

Adjust CrewAI prompt generation and context shaping so weekly/deep reviews produce:

- sharper summary
- explicit risks
- actionable store-manager suggestions
- more realistic operating language

**Step 4: Run tests to verify they pass**

Run: `cd tools/crewai-sidecar && python -m pytest tests/test_prompting.py tests/test_store_review.py`

Expected: PASS.

### Task 5: Verification Sweep

**Files:**

- Verify only

**Step 1: Run targeted Hetang verification**

Run: `pnpm test -- extensions/hetang-ops/src/runtime.test.ts extensions/hetang-ops/src/schedule.test.ts extensions/hetang-ops/src/query-engine.test.ts extensions/hetang-ops/src/inbound.test.ts`

Expected: PASS for the touched surfaces.

**Step 2: Run sidecar verification**

Run: `cd tools/crewai-sidecar && python -m pytest tests/test_prompting.py tests/test_store_review.py`

Expected: PASS.

**Step 3: Run build**

Run: `pnpm build`

Expected: exit 0.

**Step 4: Optional real backfill execution**

Run only if credentials/config are present and the operator wants a live run:

`pnpm openclaw hetang backfill --start 2026-02-01 --end 2026-02-28`

or the new February shortcut command after implementation.

Expected: slow, weekly, store-by-store progress lines with no parallel bursts.
