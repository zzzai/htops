# Customer Profile Sample Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a checked-in route-eval sample library for high-frequency `customer_profile` asks so phone-suffix customer profile phrasings are validated and expanded from real inbound audits.

**Architecture:** Reuse the existing sample-library pattern already used for metric, compare/ranking, and trend/risk/advice asks. Keep only customer-profile asks that currently route stably to `customer_profile_lookup_v1`, then review real inbound audits to catch uncovered paraphrases worth absorbing.

**Tech Stack:** TypeScript, Vitest, `tsx`, semantic routing, inbound audit coverage review.

---

### Task 1: Add red tests for customer-profile sample coverage

**Files:**
- Create: `src/customer-profile-utterance-samples.test.ts`
- Create: `src/customer-profile-route-eval-fixture-builder.test.ts`
- Create: `src/customer-profile-utterance-coverage-builder.test.ts`
- Create: `src/build-customer-profile-route-eval-fixtures-script.test.ts`
- Create: `src/review-customer-profile-utterance-coverage-script.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- checked-in JSON sample quality
- route-eval fixture generation for stable profile asks
- inbound audit coverage grouping and uncovered paraphrase filtering
- build script output
- review script output

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-profile-utterance-samples.test.ts src/customer-profile-route-eval-fixture-builder.test.ts src/customer-profile-utterance-coverage-builder.test.ts src/build-customer-profile-route-eval-fixtures-script.test.ts src/review-customer-profile-utterance-coverage-script.test.ts`

Expected: FAIL because the new JSON, builders, and scripts do not exist yet.

### Task 2: Implement the customer-profile sample library

**Files:**
- Create: `src/customer-profile-utterance-samples.json`
- Create: `src/customer-profile-route-eval-fixture-builder.ts`
- Create: `src/customer-profile-utterance-coverage-builder.ts`
- Create: `scripts/build-customer-profile-route-eval-fixtures.ts`
- Create: `scripts/review-customer-profile-utterance-coverage.ts`

**Step 1: Add the minimal stable sample library**

Include only asks that currently resolve to:
- `query:profile`
- `customer_profile_lookup_v1`

**Step 2: Implement builders and scripts**

Mirror the existing sample-library pattern:
- route-eval fixture builder validates stable `query` profile routing
- coverage builder aggregates inbound audits and flags uncovered paraphrases
- CLI scripts load config and print JSON

**Step 3: Run tests to verify they pass**

Run the same Vitest command from Task 1.

Expected: PASS.

### Task 3: Integrate the new fixtures into route-eval

**Files:**
- Modify: `src/route-eval.test.ts`

**Step 1: Append customer-profile fixtures to the typed route-eval fixture list**

**Step 2: Run focused verification**

Run: `pnpm exec vitest run src/customer-profile-route-eval-fixture-builder.test.ts src/route-eval.test.ts`

Expected: PASS.

### Task 4: Validate against real inbound audits

**Files:**
- No repo change required unless new high-frequency stable paraphrases are absorbed

**Step 1: Review uncovered real asks**

Run: `node --import tsx scripts/review-customer-profile-utterance-coverage.ts --input /tmp/htops-inbound-audit-80.json --filter uncovered`

**Step 2: Absorb high-frequency stable paraphrases if needed**

If uncovered stable asks remain, add them to the JSON sample library and rerun targeted tests plus `src/route-eval.test.ts`.

### Task 5: Final verification

Run:
- `pnpm exec vitest run src/customer-profile-utterance-samples.test.ts src/customer-profile-route-eval-fixture-builder.test.ts src/customer-profile-utterance-coverage-builder.test.ts src/build-customer-profile-route-eval-fixtures-script.test.ts src/review-customer-profile-utterance-coverage-script.test.ts src/route-eval.test.ts`

Expected: PASS with 0 failures.
