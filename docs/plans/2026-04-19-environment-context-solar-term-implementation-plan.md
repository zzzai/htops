# Environment Context Solar Term Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend `environment_context_snapshot` with Chinese 24 solar terms and use it as a bounded correction signal for reactivation strategy and analysis explanation.

**Architecture:** Keep solar-term logic inside the existing environment-context layer. Derive a deterministic `solarTerm` from `bizDate`, apply only small nudges to `postDinnerLeisureBias` and `eveningOutingLikelihood`, and reuse the resulting context in already-wired reactivation rebuild and store advice rendering paths. Do not expand `src/runtime.ts` and do not let solar terms override weather or customer facts.

**Tech Stack:** TypeScript, Node.js, Vitest, existing `htops` environment-context / reactivation / renderer modules, `apply_patch`.

---

### Task 1: Add solar-term type to environment context

**Files:**
- Modify: `src/types.ts`
- Test: `src/environment-context.test.ts`

**Step 1: Write the failing test**

Add assertions in `src/environment-context.test.ts` for a new `solarTerm` field on the context snapshot, for example:

- `2026-04-05 -> qingming`
- `2026-04-20 -> guyu`

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts
```

Expected: FAIL because `solarTerm` does not exist.

**Step 3: Write minimal implementation**

Add `EnvironmentSolarTerm` and `solarTerm?: EnvironmentSolarTerm` to `src/types.ts`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts
```

Expected: PASS for the type/shape assertions after the builder is updated.

**Step 5: Commit**

```bash
git add src/types.ts src/environment-context.test.ts
git commit -m "feat: add solar term environment types"
```

### Task 2: Derive solar terms in the environment-context builder

**Files:**
- Modify: `src/environment-context.ts`
- Test: `src/environment-context.test.ts`

**Step 1: Write the failing test**

Add builder tests for:

- fixed-date solar-term resolution near spring terms
- winter term resolution
- deterministic output with no external dependencies

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts
```

Expected: FAIL because the builder cannot derive solar terms yet.

**Step 3: Write minimal implementation**

In `src/environment-context.ts`:

- add a deterministic `resolveSolarTerm(bizDate)` helper using a fixed month-day cutoff table
- return `solarTerm` from `buildEnvironmentContextSnapshot(...)`

Do not introduce network calls or external libraries.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/environment-context.ts src/environment-context.test.ts
git commit -m "feat: derive solar terms in environment context"
```

### Task 3: Apply bounded solar-term nudges to environment bias

**Files:**
- Modify: `src/environment-context.ts`
- Test: `src/environment-context.test.ts`
- Test: `src/reactivation-strategy.test.ts`

**Step 1: Write the failing test**

Add tests showing:

- spring-comfort terms like `guyu` can mildly boost `postDinnerLeisureBias` / `eveningOutingLikelihood`
- colder terms like `shuangjiang` or `dahan` can mildly reduce them
- bad weather remains stronger than solar-term positivity

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts src/reactivation-strategy.test.ts
```

Expected: FAIL because solar terms do not affect bias values yet.

**Step 3: Write minimal implementation**

In `src/environment-context.ts`:

- add a small solar-term adjustment helper
- nudge `postDinnerLeisureBias`
- nudge `eveningOutingLikelihood`
- keep weather penalty precedence intact

Do not add large jumps or direct churn/risk rewrites.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts src/reactivation-strategy.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/environment-context.ts src/environment-context.test.ts src/reactivation-strategy.test.ts
git commit -m "feat: apply solar term nudges to environment bias"
```

### Task 4: Surface solar terms in strategy and explanation output

**Files:**
- Modify: `src/reactivation-strategy.ts`
- Modify: `src/query-engine-renderer.ts`
- Test: `src/query-engine-renderer.test.ts`
- Test: `src/store-query.test.ts`

**Step 1: Write the failing test**

Add tests verifying:

- `strategyJson` contains `solarTerm` when context is present
- renderer explanation can mention a spring term like `谷雨`
- real runtime advice path can surface the same explanation

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/query-engine-renderer.test.ts src/store-query.test.ts src/reactivation-strategy.test.ts
```

Expected: FAIL because the output does not mention solar terms yet.

**Step 3: Write minimal implementation**

Modify:

- `src/reactivation-strategy.ts` to persist `solarTerm` into `strategyJson`
- `src/query-engine-renderer.ts` to add a bounded solar-term explanation hint

Keep wording short and non-deterministic in tone, such as “通常更友好” or “更值得优先看”.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/query-engine-renderer.test.ts src/store-query.test.ts src/reactivation-strategy.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/reactivation-strategy.ts src/query-engine-renderer.ts src/query-engine-renderer.test.ts src/store-query.test.ts src/reactivation-strategy.test.ts
git commit -m "feat: surface solar term context in strategy and analysis"
```

### Task 5: Run focused regression for the activated caller paths

**Files:**
- Test only

**Step 1: Run targeted verification**

Run:

```bash
pnpm exec vitest run src/environment-context.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/store-query.test.ts src/query-engine-renderer.test.ts src/app/sync-service.test.ts src/rebuild-customer-history-local-script.test.ts
```

Expected: PASS.

**Step 2: Run the already-activated broader chain**

Run:

```bash
pnpm exec vitest run src/query-engine.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add docs/plans/2026-04-19-environment-context-solar-term-design.md docs/plans/2026-04-19-environment-context-solar-term-implementation-plan.md
git commit -m "docs: add solar term environment context plan"
```
