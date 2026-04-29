# Daily Metric Reconciliation Tool Plan

Date: 2026-04-25

## Goal

Add a bounded local tool that reconciles one store's one-day daily-report metrics against raw source facts, so operators can verify whether stored daily metrics still match the underlying business records.

## Scope

- Add a new reconciliation module under `src/`
- Add a thin standalone script under `scripts/`
- Compare:
  - raw-fact-derived expected values
  - fresh `computeDailyStoreMetrics(...)` results
  - stored `mart_daily_store_metrics` values
- Surface mismatches in text or JSON

## Non-Goals

- No new business responsibilities in `src/runtime.ts`
- No changes to daily-report production formulas unless the tool exposes a real bug
- No second reporting truth source

## Output

The tool should make three outcomes explicit:

1. fresh computation matches raw facts
2. stored mart metrics match fresh computation
3. which metrics are still not independently re-derived in this v1 audit

## Verification

- targeted Vitest coverage for parser, reconciliation logic, and report rendering
- targeted daily-metrics suite run
- `npx tsc -p tsconfig.json --noEmit`
