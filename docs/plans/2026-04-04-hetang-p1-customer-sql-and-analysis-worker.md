# Hetang P1 Customer SQL And Analysis Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Freeze the remaining customer business semantics, build the P1 customer SQL surfaces, and split the analysis poller so slow deep-analysis work no longer blocks fast reply loops.

**Architecture:** Keep the existing `PostgreSQL + TypeScript + OpenClaw runtime` layout, but move customer semantics into explicit shared constants, expose them through `mart_customer_conversion_cohorts` and `mv_customer_profile_90d`, and replace the single `service.ts` in-flight loop with independent scheduled and analysis workers.

**Tech Stack:** PostgreSQL, TypeScript, Vitest, existing `extensions/hetang-ops/src/store.ts` bootstrap SQL and `extensions/hetang-ops/src/service.ts` scheduler.

---

### Scope

1. Freeze customer semantics in code and docs:
   - customer stable identity
   - high-value member thresholds
   - groupbuy 7-day card-open / stored-value attribution
2. Build P1 SQL surfaces:
   - `mart_customer_conversion_cohorts`
   - `mv_customer_profile_90d`
3. Split `extensions/hetang-ops/src/service.ts` into independent polling workers.
4. Keep `CrewAI` on `direct-first`; do not widen multi-agent routing in this batch.

### Test Order

1. Add failing semantics coverage in `extensions/hetang-ops/src/customer-intelligence.test.ts`
2. Add failing SQL surface coverage in `extensions/hetang-ops/src/store.test.ts`
3. Add failing worker independence coverage in `extensions/hetang-ops/src/service.test.ts`
4. Implement minimal production changes until all three pass
5. Run scoped runtime verification and build

### Files

- Modify: `docs/plans/2026-03-31-hetang-ops-data-and-metrics-dictionary.md`
- Create: `extensions/hetang-ops/src/customer-semantics.ts`
- Modify: `extensions/hetang-ops/src/customer-intelligence.ts`
- Modify: `extensions/hetang-ops/src/customer-intelligence.test.ts`
- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/store.ts`
- Modify: `extensions/hetang-ops/src/store.test.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/customer-profile.ts`
- Modify: `extensions/hetang-ops/src/service.ts`
- Modify: `extensions/hetang-ops/src/service.test.ts`

### Verification

- `pnpm test -- extensions/hetang-ops/src/customer-intelligence.test.ts`
- `pnpm test -- extensions/hetang-ops/src/store.test.ts`
- `pnpm test -- extensions/hetang-ops/src/service.test.ts`
- `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts extensions/hetang-ops/src/runtime.test.ts`
- `pnpm build`
