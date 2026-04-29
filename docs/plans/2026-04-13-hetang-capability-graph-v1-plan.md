# Hetang Capability Graph V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce Capability Graph v1 as the new source of truth for serving query capability selection while preserving current runtime compatibility.

**Architecture:** Add a dedicated `capability-graph.ts` owner module, move serving capability metadata into graph nodes, and make `capability-registry.ts` a compatibility facade over the graph. Extend bridge introspection so operators and future agent adapters can see the graph version and node counts.

**Tech Stack:** TypeScript, Vitest, existing query-plan/query-engine/sql-compiler pipeline, localhost bridge contracts.

---

### Task 1: Add failing tests for graph selection and bridge introspection

**Files:**
- Create: `src/capability-graph.test.ts`
- Modify: `src/app/message-entry-service.test.ts`

**Step 1: Write the failing test**

- Assert graph snapshot exposes `capability-graph-v1`
- Assert `store_day_clock_breakdown_v1` has downstream/fallback links
- Assert graph resolves exact breakdown node for the breakdown plan
- Assert bridge capabilities expose graph version and node counts

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/capability-graph.test.ts src/app/message-entry-service.test.ts`

Expected:

- FAIL because `src/capability-graph.ts` does not exist
- FAIL because bridge capabilities do not yet expose graph metadata

### Task 2: Introduce Capability Graph v1 owner module

**Files:**
- Create: `src/capability-graph.ts`

**Step 1: Write minimal implementation**

- Define graph node types
- Register current serving nodes
- Add graph snapshot builder
- Add graph selection resolver with unmet requirement reporting

**Step 2: Run tests**

Run: `pnpm vitest run src/capability-graph.test.ts`

Expected: PASS

### Task 3: Convert capability-registry into a compatibility facade

**Files:**
- Modify: `src/capability-registry.ts`

**Step 1: Replace inline capability source with graph-backed filtering**

- `listServingCapabilities()` should filter graph nodes
- `resolveServingCapability(plan)` should delegate to graph selection

**Step 2: Run tests**

Run: `pnpm vitest run src/capability-graph.test.ts src/sql-compiler.test.ts`

Expected: PASS

### Task 4: Make query execution consume graph-backed selection

**Files:**
- Modify: `src/query-engine.ts`

**Step 1: Switch serving fast path to use graph selection**

- Preserve current renderer and SQL compiler behavior
- Keep existing runtime fallback path intact

**Step 2: Run tests**

Run: `pnpm vitest run src/query-engine.test.ts src/query-plan.test.ts src/sql-compiler.test.ts`

Expected: PASS

### Task 5: Expose graph metadata through bridge capability introspection

**Files:**
- Modify: `src/bridge/contracts.ts`
- Modify: `src/app/message-entry-service.ts`

**Step 1: Add graph version and node counters**

- `query_graph_version`
- `serving_capability_count`
- `capability_node_count`

**Step 2: Run tests**

Run: `pnpm vitest run src/app/message-entry-service.test.ts src/bridge/server.test.ts`

Expected: PASS

### Task 6: Run focused regression suite

**Files:**
- Verify only

**Step 1: Run regression tests**

Run:

```bash
pnpm vitest run \
  src/capability-graph.test.ts \
  src/app/message-entry-service.test.ts \
  src/bridge/server.test.ts \
  src/query-plan.test.ts \
  src/sql-compiler.test.ts \
  src/query-engine.test.ts \
  src/runtime.test.ts \
  src/app/query-read-service.test.ts \
  src/runtime/runtime-context.test.ts
```

Expected: PASS

**Step 2: Record known residual risk**

- Full repo still has historical TS/test debt outside this slice
- V1 graph only covers serving capability nodes, not report/advice/async analysis
