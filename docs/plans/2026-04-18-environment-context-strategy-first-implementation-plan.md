# Environment Context Strategy-First Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight `environment_context_snapshot` layer that adjusts reactivation strategy first and reuses the same context for analysis explanation without replacing business facts.

**Architecture:** Keep the existing reactivation pipeline intact and add a bounded environment-context module that derives calendar signals, accepts store/city context hints, and optionally accepts simple weather tags. Feed only low-risk adjustments into `src/reactivation-strategy.ts` and explanation helpers into queue/rendering. Do not expand `src/runtime.ts` and do not introduce a second semantic runtime.

**Tech Stack:** TypeScript, Node.js, existing `htops` domain modules, Vitest/Jest-style repo tests, `apply_patch`, existing docs/plans workflow.

---

### Task 1: Add environment context types

**Files:**
- Modify: `src/types.ts`
- Test: `src/reactivation-strategy.test.ts`

**Step 1: Write the failing test**

Add assertions in `src/reactivation-strategy.test.ts` for a new lightweight environment context input shape, covering:
- `seasonTag`
- `isWeekend`
- `weatherTag`
- `temperatureBand`
- `postDinnerLeisureBias`
- `eveningOutingLikelihood`
- `badWeatherTouchPenalty`

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/reactivation-strategy.test.ts
```

Expected: FAIL because the new environment-context types or fields do not exist.

**Step 3: Write minimal implementation**

Add exact types to `src/types.ts`:
- `EnvironmentSeasonTag`
- `EnvironmentHolidayTag`
- `EnvironmentWeatherTag`
- `EnvironmentTemperatureBand`
- `EnvironmentPrecipitationTag`
- `EnvironmentWindTag`
- `EnvironmentContextSnapshot`

Keep this type independent from `runtime.ts`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/reactivation-strategy.test.ts
```

Expected: PASS for type-level and fixture-shape expectations.

**Step 5: Commit**

```bash
git add src/types.ts src/reactivation-strategy.test.ts
git commit -m "feat: add environment context types"
```

### Task 2: Add environment context builder

**Files:**
- Create: `src/environment-context.ts`
- Test: `src/environment-context.test.ts`

**Step 1: Write the failing test**

Create `src/environment-context.test.ts` with cases for:
- deriving `seasonTag` from `bizDate`
- deriving `isWeekend`
- deriving a default `holidayTag`
- combining store/city context notes into `postDinnerLeisureBias` and `eveningOutingLikelihood`
- applying bad-weather classification from simple weather inputs

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/environment-context.test.ts
```

Expected: FAIL because `src/environment-context.ts` does not exist.

**Step 3: Write minimal implementation**

Create `src/environment-context.ts` with:
- deterministic date helpers
- a `buildEnvironmentContextSnapshot(...)` entry
- simple calendar-derived tags
- optional weather snapshot classification
- optional store/city context hints

Do not call external APIs here. Input should accept already-available tags or notes.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/environment-context.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/environment-context.ts src/environment-context.test.ts
git commit -m "feat: add environment context builder"
```

### Task 3: Thread environment context into reactivation strategy

**Files:**
- Modify: `src/reactivation-strategy.ts`
- Modify: `src/reactivation-strategy.test.ts`

**Step 1: Write the failing test**

Add explicit tests for:
- `touch_window_adjustment` on late-night capable stores with high evening-outing likelihood
- `bad_weather_penalty` reducing aggressive same-day touch recommendations
- `seasonal_nightlife_boost` mildly favoring `after-work` / `late-night`

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/reactivation-strategy.test.ts
```

Expected: FAIL because strategy ignores environment context.

**Step 3: Write minimal implementation**

Modify `src/reactivation-strategy.ts` to accept an optional `environmentContext` parameter and apply bounded adjustments only to:
- touch-window recommendation
- strategy explanation metadata
- optional low-weight priority nudges

Do not directly overwrite core customer risk facts.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/reactivation-strategy.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/reactivation-strategy.ts src/reactivation-strategy.test.ts
git commit -m "feat: apply environment context to reactivation strategy"
```

### Task 4: Expose environment-aware reason summaries in queue output

**Files:**
- Modify: `src/reactivation-queue.ts`
- Test: `src/reactivation-queue.test.ts`

**Step 1: Write the failing test**

Add queue output tests to verify:
- environment-aware reason summary lines
- environment-aware touch advice lines
- no summary pollution when context is absent

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/reactivation-queue.test.ts
```

Expected: FAIL because queue summaries do not reference environment context.

**Step 3: Write minimal implementation**

Modify `src/reactivation-queue.ts` so `reasonSummary` and `touchAdviceSummary` may append short context-aware phrases such as:
- late-night seasonality
- weather caution
- post-dinner relaxation bias

Keep summary wording concise and deterministic.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/reactivation-queue.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/reactivation-queue.ts src/reactivation-queue.test.ts
git commit -m "feat: add environment-aware queue summaries"
```

### Task 5: Reuse environment context in analysis explanation

**Files:**
- Modify: `src/query-engine-renderer.ts`
- Test: `src/tools/server.test.ts`
- Test: `src/customer-query.test.ts`

**Step 1: Write the failing test**

Add at least one analysis-rendering test where:
- the same business facts render differently once environment context is provided
- explanation mentions late-night demand / seasonal evening bias / bad-weather caution

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/tools/server.test.ts src/customer-query.test.ts
```

Expected: FAIL because renderer ignores environment context.

**Step 3: Write minimal implementation**

Modify `src/query-engine-renderer.ts` to accept optional environment context for explanation-only text.

Keep SQL output and factual summaries unchanged. Only enrich the interpretation layer.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/tools/server.test.ts src/customer-query.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/query-engine-renderer.ts src/tools/server.test.ts src/customer-query.test.ts
git commit -m "feat: reuse environment context in analysis explanations"
```

### Task 6: Add docs and usage boundaries

**Files:**
- Modify: `docs/plans/2026-04-18-three-mainlines-two-week-priority-plan.md`
- Modify: `docs/plans/2026-04-18-environment-context-strategy-first-design.md`

**Step 1: Write the failing test**

No automated test required for docs-only boundary updates. Instead create a manual checklist:
- confirmed vs estimated vs research_note boundaries are explicit
- environment context is marked as correction layer, not truth-source replacement
- strategy-first rollout order is explicit

**Step 2: Run validation**

Run:

```bash
rg -n "environment_context_snapshot|research_note|estimated_market_context|strategy-first" docs/plans
```

Expected: missing or incomplete coverage before edits.

**Step 3: Write minimal implementation**

Update docs to show:
- where environment context lives
- how it affects strategy first
- how it later feeds explanation
- what is intentionally excluded in phase one

**Step 4: Run validation**

Run:

```bash
rg -n "environment_context_snapshot|research_note|estimated_market_context|strategy-first" docs/plans
```

Expected: complete coverage after edits.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-18-three-mainlines-two-week-priority-plan.md docs/plans/2026-04-18-environment-context-strategy-first-design.md
git commit -m "docs: define environment context rollout boundaries"
```

### Task 7: Run focused verification

**Files:**
- Modify: none
- Test: `src/environment-context.test.ts`
- Test: `src/reactivation-strategy.test.ts`
- Test: `src/reactivation-queue.test.ts`
- Test: `src/customer-query.test.ts`
- Test: `src/tools/server.test.ts`

**Step 1: Run the focused test suite**

Run:

```bash
pnpm test -- src/environment-context.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-query.test.ts src/tools/server.test.ts
```

Expected: PASS.

**Step 2: Run a repo grep sanity check**

Run:

```bash
rg -n "environmentContext|EnvironmentContextSnapshot|postDinnerLeisureBias|badWeatherTouchPenalty" src
```

Expected: references appear only in bounded modules.

**Step 3: Run relevant doctor/bootstrap checks if storage or infra changed**

Run only if persistence or service integration was added:

```bash
pnpm cli -- hetang doctor
```

Expected: healthy output or known unrelated warnings only.

**Step 4: Commit**

```bash
git add .
git commit -m "test: verify strategy-first environment context rollout"
```

---

Plan complete and saved to `docs/plans/2026-04-18-environment-context-strategy-first-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
