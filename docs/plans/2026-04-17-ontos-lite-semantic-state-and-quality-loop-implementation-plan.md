# Ontos-lite Semantic State And Quality Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal semantic-state layer and a minimal semantic-quality loop so multi-turn clarify flows become stateful and semantic failures become measurable in production.

**Architecture:** Keep the business truth in the existing capability graph and safe execution path. Add one small conversation semantic-state owner and one small semantic-quality owner, then wire them into `message-entry-service`, `semantic-intent`, `admin-read-service`, and `doctor` without expanding `runtime.ts`.

**Tech Stack:** TypeScript, PostgreSQL, Vitest, existing Hetang bridge / doctor / semantic routing modules

---

### Task 1: Freeze semantic-state contracts in tests

**Files:**
- Create: `src/app/conversation-semantic-state-service.test.ts`
- Modify: `src/app/message-entry-service.test.ts`
- Modify: `src/semantic-intent.test.ts`

**Step 1: Write the failing tests**

Add tests for:

- inheriting a pending clarify state when the next message only supplies a missing time range
- inheriting a pending clarify state when the next message only supplies a missing store
- resetting state when the next message is clearly a topic switch

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/conversation-semantic-state-service.test.ts src/app/message-entry-service.test.ts src/semantic-intent.test.ts`

Expected: FAIL because the semantic-state owner and merge behavior do not exist yet.

### Task 2: Implement the minimal semantic-state owner

**Files:**
- Create: `src/app/conversation-semantic-state-service.ts`
- Create: `src/store/conversation-semantic-state-store.ts`
- Modify: `src/types.ts`

**Step 1: Add state types**

Define:

- semantic state snapshot
- anchor fact record
- state delta
- clarify pending metadata

**Step 2: Add store owner**

Implement minimal persistence methods:

- `getConversationSemanticState(sessionId)`
- `upsertConversationSemanticState(snapshot)`
- `appendConversationAnchorFacts(facts)`
- `deleteExpiredConversationSemanticState(now)`

**Step 3: Add app owner**

Implement:

- state load
- state merge
- topic-switch reset
- ttl handling

### Task 3: Wire semantic state into the message entry path

**Files:**
- Modify: `src/app/message-entry-service.ts`
- Modify: `src/semantic-intent.ts`
- Modify: `src/query-intent.ts`

**Step 1: Load state before intent resolution**

Resolve a stable session key from channel + conversation + sender and load the semantic state snapshot.

**Step 2: Feed state into semantic resolution**

Allow semantic resolution to consume:

- anchored slots
- clarify pending reason
- recent intent kind

**Step 3: Persist state after routing decision**

Write back:

- clarify pending states
- anchored slots
- resolved scope
- last route snapshot

**Step 4: Run targeted tests**

Run: `npx vitest run src/app/conversation-semantic-state-service.test.ts src/app/message-entry-service.test.ts src/semantic-intent.test.ts`

Expected: PASS.

### Task 4: Freeze semantic quality contracts in tests

**Files:**
- Create: `src/app/semantic-quality-service.test.ts`
- Modify: `src/app/admin-read-service.test.ts`
- Modify: `src/ops/doctor.test.ts`

**Step 1: Write the failing tests**

Add tests for:

- writing a structured semantic execution audit for clarify-missing-time
- writing `fallback_used=true` when AI semantic fallback is used
- aggregating 24h top failure classes
- rendering a compact semantic quality summary in doctor

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/semantic-quality-service.test.ts src/app/admin-read-service.test.ts src/ops/doctor.test.ts`

Expected: FAIL because the audit owner, summary queries, and doctor lines do not exist yet.

### Task 5: Implement the semantic quality owner

**Files:**
- Create: `src/app/semantic-quality-service.ts`
- Create: `src/store/semantic-execution-audit-store.ts`
- Modify: `src/types.ts`

**Step 1: Add audit types**

Define:

- audit write input
- failure class enum/string union
- 24h / 7d quality summary

**Step 2: Add store owner**

Implement minimal persistence and summary methods:

- `insertSemanticExecutionAudit(event)`
- `getSemanticQualitySummary(windowHours, now)`
- `getSemanticFailureTopCounts(windowHours, now, limit)`

**Step 3: Add app owner**

Provide one thin facade that normalizes audit inputs from the entry and execution path.

### Task 6: Wire semantic quality events into the runtime path

**Files:**
- Modify: `src/app/message-entry-service.ts`
- Modify: `src/semantic-intent.ts`
- Modify: `src/app/admin-read-service.ts`
- Modify: `src/ops/doctor.ts`

**Step 1: Emit audit skeleton at entry**

Capture:

- raw/effective text
- routing mode
- selected lane
- intent kind

**Step 2: Complete audit after semantic resolution**

Capture:

- clarify needed
- clarify reason
- capability id
- fallback used

**Step 3: Complete audit after execution**

Capture:

- executed
- success
- failure class
- latency

**Step 4: Add admin summary query**

Expose a minimal summary for:

- total
- success rate
- clarify rate
- fallback rate
- top failure classes

**Step 5: Add doctor formatting**

Add compact semantic quality lines without bloating existing output.

### Task 7: Run targeted regression

**Files:**
- Test only

**Step 1: Run state-focused tests**

Run: `npx vitest run src/app/conversation-semantic-state-service.test.ts src/app/message-entry-service.test.ts src/semantic-intent.test.ts`

Expected: PASS

**Step 2: Run quality-focused tests**

Run: `npx vitest run src/app/semantic-quality-service.test.ts src/app/admin-read-service.test.ts src/ops/doctor.test.ts`

Expected: PASS

**Step 3: Run broader semantic path regression**

Run: `npx vitest run src/query-intent.test.ts src/semantic-intent.test.ts src/app/message-entry-service.test.ts src/app/admin-read-service.test.ts src/ops/doctor.test.ts src/runtime.test.ts`

Expected: PASS

### Task 8: Production acceptance

**Files:**
- Modify: none unless verification reveals regression

**Step 1: Restart the relevant services after rollout**

Run: `systemctl restart htops-bridge.service`

Run: `systemctl restart htops-query-api.service`

Expected: services come back healthy.

**Step 2: Verify doctor surface**

Run: `pnpm cli -- hetang status`

Expected:

- existing scheduler / queue lines remain intact
- new semantic quality lines appear

**Step 3: Verify recent audit writes**

Run one SQL query against the app database to confirm new rows exist in `semantic_execution_audits`.

Expected:

- recent rows include clarify / success / fallback fields

### Task 9: Close the loop

**Files:**
- Modify: `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md` if implementation diverges
- Modify: `docs/plans/2026-04-17-semantic-quality-loop-design.md` if implementation diverges

**Step 1: Record the final contract**

Update the design docs with:

- exact session key shape
- final failure taxonomy
- exact doctor lines
- exact test commands executed
