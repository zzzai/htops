# Ontos-lite Truth Source Tightening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strengthen Ontos-lite in `htops` by turning capability graph into a richer semantic truth source, converting semantic quality failures into actionable backlog/sample outputs, and extending conversation semantic state beyond simple clarify carry-over.

**Architecture:** Keep the existing deterministic path intact: `Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`. Add bounded contracts to `capability-graph`, bounded summary outputs to `semantic-quality`, and bounded multi-turn state carry rules to `conversation semantic state`, without introducing a second ontology runtime or expanding `runtime.ts` into a business shell.

**Tech Stack:** TypeScript, PostgreSQL, Vitest, existing Hetang query / doctor / admin-read owner modules

---

### Task 1: Freeze capability graph contract expectations in tests

**Files:**
- Modify: `src/capability-graph.test.ts`
- Modify: `src/semantic-intent.test.ts`

**Step 1: Write the failing test**

Add tests for:

- capability nodes exposing explicit semantic contract fields:
  - `owner_surface`
  - `required_slots`
  - `optional_slots`
  - `clarification_policy`
  - `failure_hints`
  - `sample_tags`
- semantic intent using capability contract to clarify missing metric/time/store asks more consistently

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/capability-graph.test.ts src/semantic-intent.test.ts`

Expected: FAIL because capability nodes do not yet expose the richer contract and semantic-intent cannot consume it.

**Step 3: Write minimal implementation**

Modify:

- `src/capability-graph.ts`
  - extend node types with bounded semantic contract fields
  - populate those fields for the currently important store capabilities
- `src/semantic-intent.ts`
  - consume capability contract metadata for clarify policy decisions where useful

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/capability-graph.test.ts src/semantic-intent.test.ts`

Expected: PASS

### Task 2: Add semantic quality backlog and sample outputs

**Files:**
- Modify: `src/app/semantic-quality-service.test.ts`
- Modify: `src/app/admin-read-service.test.ts`
- Modify: `src/app/semantic-quality-service.ts`
- Modify: `src/app/admin-read-service.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Add tests for:

- mapping top failure classes into optimization backlog items
- mapping top failure classes into sample candidate outputs
- including owner module / recommended action / priority in backlog outputs
- exposing these outputs through `admin-read-service`

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/semantic-quality-service.test.ts src/app/admin-read-service.test.ts`

Expected: FAIL because semantic-quality only returns aggregate counts today.

**Step 3: Write minimal implementation**

Modify:

- `src/types.ts`
  - add `HetangSemanticOptimizationBacklogItem`
  - add `HetangSemanticSampleCandidate`
  - extend `HetangSemanticQualitySummary`
- `src/app/semantic-quality-service.ts`
  - derive backlog/sample outputs from `topFailureClasses`
  - keep mapping table local to the owner module
- `src/app/admin-read-service.ts`
  - return the richer summary untouched, with fallback-safe defaults

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/semantic-quality-service.test.ts src/app/admin-read-service.test.ts`

Expected: PASS

### Task 3: Extend conversation semantic state carry rules

**Files:**
- Modify: `src/app/conversation-semantic-state-service.test.ts`
- Modify: `src/semantic-intent.test.ts`
- Modify: `src/app/message-entry-service.test.ts`
- Modify: `src/query-intent.ts`
- Modify: `src/app/conversation-semantic-state-service.ts`
- Modify: `src/semantic-intent.ts`

**Step 1: Write the failing test**

Add tests for:

- carrying a pending question when the next turn only supplies a missing metric
- carrying a pending question for boss-style colloquial metric supplements
- resetting carry-over on clear topic switch
- recording richer semantic state snapshot fields after a turn completes

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/conversation-semantic-state-service.test.ts src/semantic-intent.test.ts src/app/message-entry-service.test.ts`

Expected: FAIL because state carry-over currently handles missing time/store better than missing metric / colloquial follow-up.

**Step 3: Write minimal implementation**

Modify:

- `src/query-intent.ts`
  - extend `resolveConversationSemanticEffectiveText` for:
    - missing metric supplements
    - bounded colloquial metric carry-over
    - safer topic switch reset
- `src/app/conversation-semantic-state-service.ts`
  - persist `lastCapabilityId`, `lastObject`, `lastMetricKeys`, `lastFailureClass` in anchored state
- `src/semantic-intent.ts`
  - consume carried effective text without bypassing main semantic routing

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/conversation-semantic-state-service.test.ts src/semantic-intent.test.ts src/app/message-entry-service.test.ts`

Expected: PASS

### Task 4: Keep doctor and runtime summaries stable

**Files:**
- Modify: `src/ops/doctor.test.ts`
- Modify: `src/runtime.test.ts`
- Modify: `src/ops/doctor.ts`
- Modify: `src/runtime.ts`

**Step 1: Write the failing test**

Add tests for:

- doctor still rendering compact semantic quality summary
- runtime status path remaining compatible after richer quality summary fields are added

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ops/doctor.test.ts src/runtime.test.ts`

Expected: FAIL only if new summary shape breaks rendering assumptions.

**Step 3: Write minimal implementation**

Modify formatting only where needed:

- `src/ops/doctor.ts`
- `src/runtime.ts`

Do not add new business responsibilities.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/ops/doctor.test.ts src/runtime.test.ts`

Expected: PASS

### Task 5: Broader semantic path regression

**Files:**
- Test only

**Step 1: Run targeted semantic path regression**

Run:

`npx vitest run src/capability-graph.test.ts src/semantic-intent.test.ts src/app/conversation-semantic-state-service.test.ts src/app/message-entry-service.test.ts src/app/semantic-quality-service.test.ts src/app/admin-read-service.test.ts src/ops/doctor.test.ts src/runtime.test.ts`

Expected: PASS

**Step 2: Run existing semantic query regressions**

Run:

`npx vitest run src/query-engine-semantic-quality.test.ts src/query-entry-adapter.test.ts src/inbound-bridge-regression.test.ts src/metric-query.test.ts src/query-engine.test.ts src/ai-semantic-fallback.test.ts`

Expected: PASS

### Task 6: Production-shaped verification

**Files:**
- Modify: none unless verification reveals regression

**Step 1: Verify doctor surface**

Run: `pnpm cli -- hetang status`

Expected:

- existing scheduler / queue / delivery lines remain intact
- semantic quality summary still renders
- no new ambiguity is introduced

**Step 2: Verify deterministic query behavior remains stable**

Run:

`pnpm cli -- hetang query "义乌店卡里还有多少" --user ZhangZhen`

`pnpm cli -- hetang query "义乌店昨天收了多少" --user ZhangZhen`

Expected:

- first query answers with current stored balance
- second query still clarifies instead of guessing

### Task 7: Document final state

**Files:**
- Modify: `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md` if needed
- Modify: `docs/plans/2026-04-17-semantic-quality-loop-design.md` if needed
- Modify: `docs/reviews/2026-04-17-ontos-lite-module-mapping.md` if needed

**Step 1: Update docs only if implementation diverges**

Keep docs aligned with actual owner-module behavior and actual bounded scope.

**Step 2: Verify docs diff**

Run: `git diff -- docs/plans docs/reviews`

Expected: only intentional updates remain.
