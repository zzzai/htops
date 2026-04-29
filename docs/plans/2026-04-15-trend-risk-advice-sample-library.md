# Trend Risk Advice Sample Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a third checked-in route-eval sample library for `trend` / `anomaly` / `risk` / `advice` query asks so high-frequency analysis-style query phrasings can be validated and expanded from real inbound audits.

**Architecture:** Reuse the existing metric and compare/ranking sample-library pattern. Keep only currently stable query asks in the checked-in library, generate route-eval fixtures directly from `resolveSemanticIntent()`, then review real inbound audits to find uncovered paraphrases worth absorbing.

**Tech Stack:** TypeScript, Vitest, `tsx`, existing semantic routing and inbound audit types.

---

### Task 1: Add red tests for the third sample-library lane

**Files:**
- Create: `src/trend-risk-advice-utterance-samples.test.ts`
- Create: `src/trend-risk-advice-route-eval-fixture-builder.test.ts`
- Create: `src/trend-risk-advice-utterance-coverage-builder.test.ts`
- Create: `src/build-trend-risk-advice-route-eval-fixtures-script.test.ts`
- Create: `src/review-trend-risk-advice-utterance-coverage-script.test.ts`

**Step 1: Write the failing tests**

Add test coverage for:
- checked-in JSON sample quality
- fixture generation for stable primary asks
- inbound audit coverage grouping and uncovered paraphrase filtering
- build script output
- review script output

**Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/trend-risk-advice-utterance-samples.test.ts src/trend-risk-advice-route-eval-fixture-builder.test.ts src/trend-risk-advice-utterance-coverage-builder.test.ts src/build-trend-risk-advice-route-eval-fixtures-script.test.ts src/review-trend-risk-advice-utterance-coverage-script.test.ts`

Expected: FAIL because the new JSON, builders, and scripts do not exist yet.

### Task 2: Implement the third sample library

**Files:**
- Create: `src/trend-risk-advice-utterance-samples.json`
- Create: `src/trend-risk-advice-route-eval-fixture-builder.ts`
- Create: `src/trend-risk-advice-utterance-coverage-builder.ts`
- Create: `scripts/build-trend-risk-advice-route-eval-fixtures.ts`
- Create: `scripts/review-trend-risk-advice-utterance-coverage.ts`

**Step 1: Add the minimal stable sample library**

Include only asks that currently resolve stably to:
- `query:trend`
- `query:anomaly`
- `query:risk`
- `query:advice`

**Step 2: Implement builders and scripts**

Mirror the compare/ranking pattern:
- route-eval fixture builder validates stable `query` routing
- coverage builder aggregates inbound audits and flags uncovered paraphrases
- CLI scripts load config and print JSON

**Step 3: Run targeted tests**

Run the same Vitest command from Task 1.

Expected: PASS.

### Task 3: Integrate the new sample fixtures into route-eval

**Files:**
- Modify: `src/route-eval.test.ts`

**Step 1: Extend route-eval fixture assembly**

Append the new trend/risk/advice fixtures into the typed fixture list.

**Step 2: Run focused verification**

Run: `pnpm exec vitest run src/route-eval.test.ts src/trend-risk-advice-route-eval-fixture-builder.test.ts`

Expected: PASS.

### Task 4: Validate against real inbound audits

**Files:**
- No repo file required unless a stable uncovered paraphrase should be absorbed

**Step 1: Review uncovered real asks**

Run: `node --import tsx scripts/review-trend-risk-advice-utterance-coverage.ts --input /tmp/htops-inbound-audit-80.json --filter uncovered`

**Step 2: Absorb any high-frequency stable paraphrases if needed**

If stable uncovered asks remain, add them to the JSON sample library and rerun:
- targeted tests
- review script
- `src/route-eval.test.ts`

### Task 5: Final verification

Run:
- `pnpm exec vitest run src/trend-risk-advice-utterance-samples.test.ts src/trend-risk-advice-route-eval-fixture-builder.test.ts src/trend-risk-advice-utterance-coverage-builder.test.ts src/build-trend-risk-advice-route-eval-fixtures-script.test.ts src/review-trend-risk-advice-utterance-coverage-script.test.ts src/route-eval.test.ts`

Expected: PASS with 0 failures.
