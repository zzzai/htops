# Hetang Analysis Service Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move analysis queue and delivery logic out of `src/runtime.ts` into an owner service while keeping the runtime API stable.

**Architecture:** Keep `HetangOpsRuntime` as a compatibility facade and introduce `src/app/analysis-service.ts` as the owner of analysis queue operations, reply rendering, action auto-creation, and orchestrator wiring. Runtime keeps only bootstrap and compatibility forwarding, while scoped-query execution stays injectable so the query plane is not coupled back into the service.

**Tech Stack:** TypeScript, Vitest, PostgreSQL-backed store facade, existing analysis orchestrator.

---

### Task 1: Lock analysis-owner behavior with tests

**Files:**
- Create: `src/app/analysis-service.test.ts`

**Steps**

1. Write a failing test for sanitized failed-analysis reply rendering.
2. Write a failing test for capped / deduped action auto-creation.
3. Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts
```

### Task 2: Extract the owner service

**Files:**
- Create: `src/app/analysis-service.ts`
- Modify: `src/runtime.ts`

**Steps**

1. Move analysis queue methods and orchestrator-owned callbacks into the new service.
2. Keep runtime public methods as thin delegations.
3. Remove duplicated analysis helpers from `src/runtime.ts`.

### Task 3: Run focused regression verification

**Files:**
- Modify if needed: `src/runtime.test.ts`

**Steps**

1. Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts src/runtime.test.ts src/service.test.ts src/analysis-orchestrator.test.ts
```

2. Fix regressions until the analysis extraction stays green.
