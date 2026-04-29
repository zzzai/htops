# Hetang API Field Audit And Prompt Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Audit the real fields returned by the 8 Hetang APIs, expose immediately useful operational signals from raw data, and upgrade the CrewAI sidecar prompt so it reflects true field availability instead of assumed metrics.

**Architecture:** Keep the sync pipeline unchanged for this pass, but enrich the sidecar analysis context by deriving extra signals from existing `fact_*` tables and embedded `raw_json`. Document the field inventory separately so future normalization and mart work can be prioritized with confidence.

**Tech Stack:** PostgreSQL, TypeScript field model reference, Python 3.12 sidecar, CrewAI, unittest

---

### Task 1: Write the field-audit artifact

**Files:**

- Create: `docs/plans/2026-03-31-hetang-api-field-audit.md`

**Step 1: Gather the real field inventory**

Use the already stored `raw_api_rows` samples from endpoints `1.1` to `1.8` to list observed keys.

**Step 2: Write the audit**

For each endpoint, record:

- observed raw fields
- current normalized fields
- high-value business fields not yet normalized
- immediate analysis value

**Step 3: Verify the audit is grounded**

Cross-check the audit against:

- `extensions/hetang-ops/src/types.ts`
- `extensions/hetang-ops/src/normalize.ts`

### Task 2: Add supplementary sidecar context from real fields

**Files:**

- Modify: `tools/crewai-sidecar/store_review.py`
- Test: `tools/crewai-sidecar/tests/test_store_review.py`

**Step 1: Write the failing test**

Add tests expecting the sidecar context to expose:

- group-buy payment summary
- add-clock distribution
- clock-type distribution
- market item-type summary

**Step 2: Run tests to verify they fail**

Run: `source tools/crewai-sidecar/.venv/bin/activate && python -m unittest discover -s tools/crewai-sidecar/tests -v`

Expected: FAIL because these blocks are not present yet.

**Step 3: Implement minimal context derivation**

Read the additional signals from current tables:

- `fact_consume_bills.raw_json -> Payments`
- `fact_tech_up_clock.raw_json -> AddClockType / ClockType`
- `fact_tech_market.raw_json -> ItemTypeName / ItemCategory / IsDonate`

**Step 4: Re-run tests**

Expected: PASS

### Task 3: Upgrade the production prompt to match real field availability

**Files:**

- Modify: `tools/crewai-sidecar/prompting.py`
- Test: `tools/crewai-sidecar/tests/test_prompting.py`

**Step 1: Write the failing test**

Expect the rendered prompt to:

- mention group-buy and add-clock analysis when those blocks are present
- stop describing group-buy and add-clock as unavailable
- keep explicit caution where only raw fields exist but business mapping is not final (for example addon penetration)

**Step 2: Run test to verify it fails**

Run: `source tools/crewai-sidecar/.venv/bin/activate && python -m unittest discover -s tools/crewai-sidecar/tests -v`

Expected: FAIL against the old prompt.

**Step 3: Implement minimal prompt changes**

Use `ht.md` selectively:

- merge Part 0 system rules
- merge point/add-clock/group-buy reasoning rules only when the context supports them
- explicitly mark unresolved semantics as “raw field exists, mapping still pending” instead of claiming the metric is impossible

**Step 4: Re-run tests**

Expected: PASS

### Task 4: Verify on real Yiwu data

**Files:**

- Modify: `tools/crewai-sidecar/README.md`

**Step 1: Run the real context print**

Run: `source tools/crewai-sidecar/.venv/bin/activate && cd tools/crewai-sidecar && python store_review.py --org 627150985244677 --start 2026-03-24 --end 2026-03-30 --print-context`

Expected: context now contains group-buy, add-clock, clock-type, and market summaries.

**Step 2: Run the full analysis**

Run: `source tools/crewai-sidecar/.venv/bin/activate && cd tools/crewai-sidecar && python store_review.py --org 627150985244677 --start 2026-03-24 --end 2026-03-30`

Expected: manager review now reflects the new field-backed signals.
