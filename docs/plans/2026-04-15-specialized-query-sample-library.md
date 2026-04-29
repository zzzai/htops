# Specialized Query Sample Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a checked-in route-eval sample library for the remaining graph-backed specialized query capabilities so report, list, tech profile, arrival distribution, wait analysis, and member-source analysis asks are guarded by the same sample-library and audit-coverage workflow.

**Architecture:** Reuse the existing sample-library pattern, but filter coverage by capability id instead of action. This avoids overlap with the existing metric, compare/ranking, trend/risk/advice, and customer-profile sample libraries while still validating stable specialized query asks against `resolveSemanticIntent()`.

**Tech Stack:** TypeScript, Vitest, `tsx`, semantic routing, inbound audit coverage review.

---

### Task 1: Add red tests for the specialized capability sample library

**Files:**
- Create: `src/specialized-query-utterance-samples.test.ts`
- Create: `src/specialized-query-route-eval-fixture-builder.test.ts`
- Create: `src/specialized-query-utterance-coverage-builder.test.ts`
- Create: `src/build-specialized-query-route-eval-fixtures-script.test.ts`
- Create: `src/review-specialized-query-utterance-coverage-script.test.ts`

**Step 1: Write the failing tests**

Cover:
- checked-in JSON sample quality
- route-eval fixture generation for specialized capabilities
- inbound audit coverage grouping and uncovered paraphrase filtering
- build script output
- review script output

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/specialized-query-utterance-samples.test.ts src/specialized-query-route-eval-fixture-builder.test.ts src/specialized-query-utterance-coverage-builder.test.ts src/build-specialized-query-route-eval-fixtures-script.test.ts src/review-specialized-query-utterance-coverage-script.test.ts`

Expected: FAIL because the new JSON, builders, and scripts do not exist yet.

### Task 2: Implement the specialized sample library

**Files:**
- Create: `src/specialized-query-utterance-samples.json`
- Create: `src/specialized-query-route-eval-fixture-builder.ts`
- Create: `src/specialized-query-utterance-coverage-builder.ts`
- Create: `scripts/build-specialized-query-route-eval-fixtures.ts`
- Create: `scripts/review-specialized-query-utterance-coverage.ts`

**Step 1: Add the minimal stable sample library**

Include only asks that currently resolve to specialized graph-backed capabilities such as:
- `store_report_v1`
- `birthday_member_list_v1`
- `customer_ranked_list_lookup_v1`
- `tech_profile_lookup_v1`
- `arrival_profile_timeseries_v1`
- `wait_experience_analysis_v1`
- `member_marketing_analysis_v1`

**Step 2: Implement builders and scripts**

Mirror the sample-library pattern:
- route-eval fixture builder validates stable `query` routing
- coverage builder aggregates inbound audits and filters by the specialized capability id set
- CLI scripts load config and print JSON

**Step 3: Run tests to verify they pass**

Run the same Vitest command from Task 1.

Expected: PASS.

### Task 3: Integrate the new fixtures into route-eval

**Files:**
- Modify: `src/route-eval.test.ts`

**Step 1: Append specialized fixtures to the typed route-eval fixture list**

**Step 2: Run focused verification**

Run: `pnpm exec vitest run src/specialized-query-route-eval-fixture-builder.test.ts src/route-eval.test.ts`

Expected: PASS.

### Task 4: Validate against real inbound audits

**Files:**
- No repo change required unless later real audits reveal stable specialized paraphrases worth absorbing

**Step 1: Review uncovered real asks**

Run: `node --import tsx scripts/review-specialized-query-utterance-coverage.ts --input /tmp/htops-inbound-audit-80.json --filter uncovered`

**Step 2: Absorb high-frequency stable paraphrases if needed**

If uncovered stable asks remain, add them to the JSON sample library and rerun targeted tests plus `src/route-eval.test.ts`.

### Task 5: Final verification

Run:
- `pnpm exec vitest run src/specialized-query-utterance-samples.test.ts src/specialized-query-route-eval-fixture-builder.test.ts src/specialized-query-utterance-coverage-builder.test.ts src/build-specialized-query-route-eval-fixtures-script.test.ts src/review-specialized-query-utterance-coverage-script.test.ts src/route-eval.test.ts`

Expected: PASS with 0 failures.
