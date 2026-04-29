# Hetang Operational Biz Day Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Hetang storage and reporting from natural-day attribution to operational business-day attribution with a `05:00` cutoff.

**Architecture:** Add a shared operational-day helper in `time.ts`, thread the cutoff through config, and make all fact normalization plus report date defaults depend on that helper. Keep raw timestamps unchanged and let the upcoming March backfill rewrite facts under the new `biz_date` semantics.

**Tech Stack:** TypeScript, Vitest, PostgreSQL, bundled OpenClaw plugin metadata

---

### Task 1: Add Operational-Day Time Helpers

**Files:**

- Modify: `extensions/hetang-ops/src/time.ts`
- Modify: `extensions/hetang-ops/src/sign-and-time.test.ts`

**Step 1: Write failing tests**

- Add tests for:
  - `2026-03-31 02:30:00` maps to `2026-03-30`
  - `2026-03-31 05:00:00` maps to `2026-03-31`
  - report default at `2026-03-31 03:10+08:00` resolves to `2026-03-29`
  - report default at `2026-03-31 08:50+08:00` resolves to `2026-03-30`

**Step 2: Run red test**

Run: `pnpm test -- extensions/hetang-ops/src/sign-and-time.test.ts`

**Step 3: Implement minimal helper layer**

- Add a shared `05:00` default cutoff.
- Add helpers to derive operational `biz_date` from:
  - a local timestamp string
  - a `Date`
- Make `resolveReportBizDate` return the most recently completed operational day.

**Step 4: Run green test**

Run: `pnpm test -- extensions/hetang-ops/src/sign-and-time.test.ts`

### Task 2: Thread Cutoff Through Config And Plugin Metadata

**Files:**

- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/config.ts`
- Modify: `extensions/hetang-ops/src/config.test.ts`
- Modify: `extensions/hetang-ops/openclaw.plugin.json`
- Modify: `src/plugins/bundled-plugin-metadata.generated.ts`

**Step 1: Write failing test**

- Assert config exposes `sync.businessDayCutoffLocalTime` and defaults it to `05:00`.

**Step 2: Run red test**

Run: `pnpm test -- extensions/hetang-ops/src/config.test.ts`

**Step 3: Implement config wiring**

- Add `businessDayCutoffLocalTime` to config types, parser defaults, and JSON schema.
- Regenerate bundled plugin metadata.

**Step 4: Run green test**

Run: `pnpm test -- extensions/hetang-ops/src/config.test.ts`

### Task 3: Move Fact And Snapshot Attribution To Operational Biz Date

**Files:**

- Modify: `extensions/hetang-ops/src/normalize.ts`
- Modify: `extensions/hetang-ops/src/sync.ts`
- Modify: `extensions/hetang-ops/src/sync-and-report.test.ts`

**Step 1: Write failing tests**

- Add a test fixture with overnight timestamps to prove:
  - `1.2/1.3/1.4/1.6/1.7` rows from `00:00-04:59` land on the prior `biz_date`
  - snapshot endpoints `1.1/1.5/1.8` use operational day at sync time

**Step 2: Run red test**

Run: `pnpm test -- extensions/hetang-ops/src/sync-and-report.test.ts`

**Step 3: Implement minimal attribution changes**

- Pass the cutoff into normalization helpers.
- Snapshot member, tech, and commission rows against the operational day active at sync time.

**Step 4: Run green test**

Run: `pnpm test -- extensions/hetang-ops/src/sync-and-report.test.ts`

### Task 4: Move Analysis, Query Defaults, And NL Routing To Operational Day

**Files:**

- Modify: `extensions/hetang-ops/src/metrics.ts`
- Modify: `extensions/hetang-ops/src/inbound.ts`
- Modify: `extensions/hetang-ops/src/command.ts`
- Modify: `extensions/hetang-ops/src/inbound.test.ts`
- Modify: `extensions/hetang-ops/src/command.test.ts`

**Step 1: Write failing tests**

- Lock previous-day comparison and inbound `今天/昨天` resolution to the new operational-day semantics.

**Step 2: Run red test**

Run: `pnpm test -- extensions/hetang-ops/src/inbound.test.ts extensions/hetang-ops/src/command.test.ts`

**Step 3: Implement minimal query-date changes**

- Use the operational-day helpers for:
  - report defaults
  - inbound relative-day interpretation
  - new-member counts
  - previous-day metric lookup

**Step 4: Run green test**

Run: `pnpm test -- extensions/hetang-ops/src/inbound.test.ts extensions/hetang-ops/src/command.test.ts`

### Task 5: Verify Step 1 End-To-End And Prepare Backfill Hand-Off

**Files:**

- Review: `extensions/hetang-ops/src/*.ts`
- Review: `docs/plans/2026-03-31-hetang-operational-biz-day-design.md`

**Step 1: Run focused plugin verification**

Run:

```bash
pnpm test -- \
  extensions/hetang-ops/src/sign-and-time.test.ts \
  extensions/hetang-ops/src/config.test.ts \
  extensions/hetang-ops/src/sync.test.ts \
  extensions/hetang-ops/src/sync-and-report.test.ts \
  extensions/hetang-ops/src/inbound.test.ts \
  extensions/hetang-ops/src/command.test.ts \
  extensions/hetang-ops/src/runtime.test.ts \
  extensions/hetang-ops/index.test.ts
```

**Step 2: Run build**

Run:

```bash
set -a && source /root/.openclaw/hetang-ops.env && set +a && pnpm build
```

**Step 3: Commit scoped step-1 changes**

Use `scripts/committer` with only the touched Hetang files and plan docs.
