# Hetang Ops Core Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the stable Hetang query semantics core into an independent workspace package so `extensions/hetang-ops` becomes an OpenClaw adapter layer instead of the primary home of business logic.

**Architecture:** Phase 1 extracts the query understanding core only: metric intent, time parsing, semantic slotting, route registry, and query intent resolution. `extensions/hetang-ops` keeps the existing file paths as thin compatibility re-exports so the runtime, inbound flow, and tests can keep using the same surfaces while the implementation now lives in `packages/hetang-ops-core`.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, tsconfig path aliases, OpenClaw bundled plugin build.

---

### Task 1: Freeze the extraction boundary

**Files:**
- Create: `docs/plans/2026-04-08-hetang-ops-core-extraction.md`
- Modify: `tsconfig.json`

**Step 1: Define the phase-1 scope**

Extract only these runtime-agnostic modules:
- `metric-query`
- `time`
- `query-semantics`
- `query-route-registry`
- `query-intent`

Keep these in the OpenClaw adapter for now:
- plugin entry
- inbound handler
- runtime/service orchestration
- notify/delivery
- store/sync/sql execution
- async analysis dispatch

**Step 2: Add workspace source resolution**

Add `packages/**/*` to TypeScript include and add path aliases for:
- `@openclaw/hetang-ops-core`
- `@openclaw/hetang-ops-core/*`

**Step 3: Verify the boundary with a failing import test**

Add a Vitest file under `extensions/hetang-ops/src/` that imports query semantics and intent resolution from `@openclaw/hetang-ops-core/*`.

### Task 2: Create the independent core package

**Files:**
- Create: `packages/hetang-ops-core/package.json`
- Create: `packages/hetang-ops-core/src/index.ts`
- Create: `packages/hetang-ops-core/src/types.ts`
- Create: `packages/hetang-ops-core/src/metric-query.ts`
- Create: `packages/hetang-ops-core/src/time.ts`
- Create: `packages/hetang-ops-core/src/query-semantics.ts`
- Create: `packages/hetang-ops-core/src/query-route-registry.ts`
- Create: `packages/hetang-ops-core/src/query-intent.ts`

**Step 1: Move the shared query-support types**

Move the existing `types.ts` file wholesale in phase 1 so the extracted query core can keep its current type surface without adding conversion glue or duplicate definitions.

**Step 2: Move the stable query core**

Copy the current implementations into the new package with imports rewritten to local core files.

**Step 3: Export the new public surface**

Expose the extracted modules through package `exports` and `src/index.ts`.

### Task 3: Convert the extension into a compatibility adapter

**Files:**
- Modify: `extensions/hetang-ops/src/metric-query.ts`
- Modify: `extensions/hetang-ops/src/time.ts`
- Modify: `extensions/hetang-ops/src/query-semantics.ts`
- Modify: `extensions/hetang-ops/src/query-route-registry.ts`
- Modify: `extensions/hetang-ops/src/query-intent.ts`

**Step 1: Replace implementation with thin re-exports**

Each file should only re-export from `@openclaw/hetang-ops-core/<module>`.

**Step 2: Preserve current import paths**

Do not change extension call sites in phase 1; the wrappers are the compatibility seam.

### Task 4: Verify extraction does not regress runtime behavior

**Files:**
- Test: `extensions/hetang-ops/src/core-extraction.test.ts`
- Test: `extensions/hetang-ops/src/query-semantics.test.ts`
- Test: `extensions/hetang-ops/src/query-route-registry.test.ts`
- Test: `extensions/hetang-ops/src/query-intent.test.ts`
- Test: `extensions/hetang-ops/src/query-engine.test.ts`
- Test: `extensions/hetang-ops/src/inbound.test.ts`

**Step 1: Run the new focused test first**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/core-extraction.test.ts
```

Expected before implementation: FAIL because `@openclaw/hetang-ops-core/*` does not resolve.

**Step 2: Run focused compatibility tests after implementation**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/core-extraction.test.ts extensions/hetang-ops/src/query-semantics.test.ts extensions/hetang-ops/src/query-route-registry.test.ts extensions/hetang-ops/src/query-intent.test.ts
```

**Step 3: Run one higher-level safety check**

Run:

```bash
pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "uses AI semantic fallback"
```

**Step 4: Run build**

Run:

```bash
pnpm build
```

### Task 5: Prepare phase-2 extraction seam

**Files:**
- No production code changes required in phase 1

**Step 1: Record the next boundary**

Phase 2 should extract:
- runtime-agnostic profile builders
- store/report query contract types
- notification abstraction
- standalone worker entrypoints

**Step 2: Keep OpenClaw as adapter only**

After phase 1, the extension still owns the plugin entry and gateway integration, but the business query core has a new canonical home.
