# Hetang Boss Review And Async Messaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand老板口吻经营问题 coverage and make async复盘 progress/completion replies feel more like a real assistant.

**Architecture:** Keep the existing split between async store review and sync HQ portfolio. Extend phrase recognition in `query-intent.ts` and polish queue/completion messaging in `analysis-queue-message.ts` and `runtime.ts`, without changing the analysis job state machine.

**Tech Stack:** TypeScript, Vitest, existing `hetang-ops` intent routing and notification pipeline.

---

### Task 1: Add failing intent and message tests

**Files:**

- Modify: `extensions/hetang-ops/src/query-intent.test.ts`
- Modify: `extensions/hetang-ops/src/inbound.test.ts`
- Create: `extensions/hetang-ops/src/analysis-queue-message.test.ts`

**Step 1: Write the failing tests**

- Add an HQ portfolio intent test for `近30天五店盘子稳不稳，哪家店最近最危险`.
- Add an inbound async-analysis test for `义乌店近30天盘子稳不稳`.
- Add queue-message tests for:
  - `created`
  - `reused-pending`
  - `reused-running`

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- extensions/hetang-ops/src/query-intent.test.ts extensions/hetang-ops/src/inbound.test.ts extensions/hetang-ops/src/analysis-queue-message.test.ts`

Expected: FAIL on missing phrase coverage and/or missing message snapshots.

### Task 2: Implement minimal recognition and messaging changes

**Files:**

- Modify: `extensions/hetang-ops/src/query-intent.ts`
- Modify: `extensions/hetang-ops/src/analysis-queue-message.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1: Extend boss-phrase coverage**

- Add “盘子稳不稳 / 最近哪家店危险 / 最近哪家店掉得厉害” style phrases.

**Step 2: Upgrade queue-stage copy**

- Keep the same state mapping.
- Make each state tell the user:
  - what is happening now
  - what the assistant is checking
  - what they will receive next

**Step 3: Upgrade completion reply**

- Keep `完成摘要` for compatibility.
- Add a more natural top line and a stable `正式回复` section label when a body is appended.

**Step 4: Run tests to verify they pass**

Run: `pnpm test -- extensions/hetang-ops/src/query-intent.test.ts extensions/hetang-ops/src/inbound.test.ts extensions/hetang-ops/src/analysis-queue-message.test.ts`

Expected: PASS.

### Task 3: Verify adjacent surfaces

**Files:**

- No extra changes unless verification reveals a regression.

**Step 1: Run scoped command/runtime tests**

Run: `pnpm test -- extensions/hetang-ops/src/command.test.ts extensions/hetang-ops/src/runtime.test.ts`

**Step 2: Run build**

Run: `pnpm build`

**Step 3: Summarize**

- Report which boss-style questions now route more reliably.
- Report the new async response shape.
