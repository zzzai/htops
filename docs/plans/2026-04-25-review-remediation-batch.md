# Review Remediation Batch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining practical repo-health findings from the 2026-04-25 review without expanding `runtime.ts` or introducing a second semantic/runtime layer.

**Architecture:** Keep the remediation bounded to owner-boundary tightening, semantic control-plane cleanup, serving publication correctness, and test portability. Avoid broad `store.ts` rewrites; prefer minimal backward-compatible changes that remove drift and restore trustworthy behavior.

**Tech Stack:** TypeScript, Vitest, PostgreSQL/pg, pg-mem

---

### Task 1: Tighten `sync-service` serving publication ownership

**Files:**
- Modify: `src/app/sync-service.ts`
- Test: `src/app/sync-service.test.ts`

1. Add a failing test for missing `store.getServingPublicationStore()` on a path that requires serving publication access.
2. Run `npx vitest run src/app/sync-service.test.ts` and confirm the new test fails for the right reason.
3. Change `resolveServingPublicationStore(...)` to fail fast instead of falling back to the whole store.
4. Re-run `npx vitest run src/app/sync-service.test.ts`.

### Task 2: Remove dead `conversation_anchor_facts` write path

**Files:**
- Modify: `src/app/conversation-semantic-state-service.ts`
- Modify: `src/app/conversation-semantic-state-service.test.ts`
- Modify: `src/store/conversation-semantic-state-store.ts`

1. Remove the anchor-fact append dependency from the state service interface and tests.
2. Remove `conversation_anchor_facts` creation and append writes from the store implementation.
3. Keep `conversation_semantic_state` snapshot behavior intact.
4. Run `npx vitest run src/app/conversation-semantic-state-service.test.ts`.

### Task 3: Migrate semantic time fields to typed timestamps

**Files:**
- Modify: `src/store/conversation-semantic-state-store.ts`
- Modify: `src/store/semantic-execution-audit-store.ts`
- Add/Modify tests for timestamp normalization and initialization SQL coverage

1. Change semantic-state and semantic-audit schemas to `timestamptz`.
2. Add compatibility normalization so store reads still return ISO strings when pg yields `Date`.
3. Keep inserts/filters working with ISO string inputs.
4. Run targeted tests for the updated stores.

### Task 4: Make serving rebuilds publish a new serving version

**Files:**
- Modify: `src/store/serving-publication-store.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`
- Modify: `src/app/sync-service.test.ts` if behavior expectations change

1. Ensure any rebuild/refresh that changes serving data publishes a manifest/version, even without explicit `publishedAt` parameters.
2. Preserve no-op behavior when nothing changed.
3. Add regression coverage around `forceRebuildAnalyticsViews()` and implicit refresh publication.
4. Run targeted serving publication tests.

### Task 5: Guard localhost-binding tests as integration-only

**Files:**
- Modify: `src/bridge/server.test.ts`
- Modify: `src/tools/server.test.ts`
- Modify: `src/app/analysis-local-sidecar.test.ts`

1. Add a single explicit env guard for tests that require binding `127.0.0.1`.
2. Default these tests to skipped in restricted environments.
3. Keep local/dev opt-in straightforward.

### Task 6: Verify the remediation batch

**Run:**
- `npx vitest run src/app/sync-service.test.ts src/app/conversation-semantic-state-service.test.ts src/store.test.ts src/store/semantic-execution-audit-store.test.ts src/bridge/server.test.ts src/tools/server.test.ts src/app/analysis-local-sidecar.test.ts`
- `npx tsc -p tsconfig.json --noEmit`

**Expected:**
- All targeted tests pass or localhost-only suites are explicitly skipped by guard.
- TypeScript exits with code `0`.
