# Customer Growth Directory And AI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the customer profile / segmentation / reactivation domain into a dedicated `src/customer-growth/` owner directory and add bounded AI advisory capabilities without changing deterministic ranking ownership.

**Architecture:** Keep the existing deterministic customer growth kernel as the source of truth, move that kernel into a dedicated owner directory, and add optional AI advisory modules that only emit structured JSON sidecar outputs. Query, sync, reporting, and tools will call the new owner modules directly, while temporary root-level re-exports preserve migration safety.

**Tech Stack:** TypeScript, Vitest, existing Hetang config/runtime/store stack, optional OpenAI-compatible HTTP client

---

### Task 1: Create The Customer Growth Owner Directory And Move Shared Helpers

**Files:**
- Create: `src/customer-growth/`
- Create: `src/customer-growth/reactivation/`
- Create: `src/customer-growth/environment-context.ts`
- Create: `src/customer-growth/birthday-utils.ts`
- Create: `src/customer-growth/semantics.ts`
- Modify: `src/environment-context.ts`
- Modify: `src/birthday-utils.ts`
- Modify: `src/customer-semantics.ts`
- Test: `src/environment-context.test.ts`

**Step 1: Write the failing test**

Add or update tests that import the new owner-path modules and assert they expose the same public behavior as the current root modules.

```ts
import { buildEnvironmentContextSnapshot } from "./customer-growth/environment-context.js";

it("keeps environment context behavior stable after owner migration", () => {
  const result = buildEnvironmentContextSnapshot({
    bizDate: "2026-04-19",
    weatherTag: "clear",
  });
  expect(result.solarTerm).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/environment-context.test.ts`

Expected: FAIL because the new owner-path module does not exist yet.

**Step 3: Write minimal implementation**

- Copy the implementations of:
  - `src/environment-context.ts`
  - `src/birthday-utils.ts`
  - `src/customer-semantics.ts`
  into `src/customer-growth/`
- Replace the root files with thin re-exports:

```ts
export * from "./customer-growth/environment-context.js";
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/environment-context.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/customer-growth/environment-context.ts src/customer-growth/birthday-utils.ts src/customer-growth/semantics.ts src/environment-context.ts src/birthday-utils.ts src/customer-semantics.ts src/environment-context.test.ts
git commit -m "refactor: create customer growth shared helper owner modules"
```

### Task 2: Move Customer Intelligence, Profile, Query, And History Modules

**Files:**
- Create: `src/customer-growth/intelligence.ts`
- Create: `src/customer-growth/profile.ts`
- Create: `src/customer-growth/query.ts`
- Create: `src/customer-growth/history-backfill.ts`
- Modify: `src/customer-intelligence.ts`
- Modify: `src/customer-profile.ts`
- Modify: `src/customer-query.ts`
- Modify: `src/customer-history-backfill.ts`
- Modify: `src/query-engine-executor.ts`
- Modify: `src/tools/handlers.ts`
- Modify: `src/app/sync-service.ts`
- Test: `src/customer-intelligence.test.ts`
- Test: `src/customer-profile.test.ts`
- Test: `src/customer-query.test.ts`
- Test: `src/customer-history-backfill.test.ts`

**Step 1: Write the failing test**

Add at least one import-path regression assertion per moved module.

```ts
import { lookupStructuredCustomerProfile } from "./customer-growth/profile.js";

it("reads structured customer profile from the customer growth owner module", async () => {
  expect(typeof lookupStructuredCustomerProfile).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-intelligence.test.ts src/customer-profile.test.ts src/customer-query.test.ts src/customer-history-backfill.test.ts`

Expected: FAIL because the new owner-path files do not exist yet.

**Step 3: Write minimal implementation**

- Move implementations into:
  - `src/customer-growth/intelligence.ts`
  - `src/customer-growth/profile.ts`
  - `src/customer-growth/query.ts`
  - `src/customer-growth/history-backfill.ts`
- Leave the root files as thin re-exports.
- Update direct runtime entrypoints to import from the owner directory:
  - `src/query-engine-executor.ts`
  - `src/tools/handlers.ts`
  - `src/app/sync-service.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-intelligence.test.ts src/customer-profile.test.ts src/customer-query.test.ts src/customer-history-backfill.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/customer-growth/intelligence.ts src/customer-growth/profile.ts src/customer-growth/query.ts src/customer-growth/history-backfill.ts src/customer-intelligence.ts src/customer-profile.ts src/customer-query.ts src/customer-history-backfill.ts src/query-engine-executor.ts src/tools/handlers.ts src/app/sync-service.ts src/customer-intelligence.test.ts src/customer-profile.test.ts src/customer-query.test.ts src/customer-history-backfill.test.ts
git commit -m "refactor: move customer growth intelligence modules under owner directory"
```

### Task 3: Move Reactivation Modules And Execution Service

**Files:**
- Create: `src/customer-growth/reactivation/features.ts`
- Create: `src/customer-growth/reactivation/strategy.ts`
- Create: `src/customer-growth/reactivation/queue.ts`
- Create: `src/customer-growth/reactivation/push.ts`
- Create: `src/customer-growth/reactivation/execution-service.ts`
- Modify: `src/reactivation-features.ts`
- Modify: `src/reactivation-strategy.ts`
- Modify: `src/reactivation-queue.ts`
- Modify: `src/reactivation-push.ts`
- Modify: `src/app/reactivation-execution-service.ts`
- Modify: `src/app/reporting-service.ts`
- Modify: `src/app/sync-service.ts`
- Test: `src/reactivation-features.test.ts`
- Test: `src/reactivation-strategy.test.ts`
- Test: `src/reactivation-queue.test.ts`
- Test: `src/reactivation-push.test.ts`
- Test: `src/app/reactivation-execution-service.test.ts`

**Step 1: Write the failing test**

Add owner-path import assertions and one smoke-style regression for queue ranking.

```ts
import { buildMemberReactivationQueueForBizDate } from "./customer-growth/reactivation/queue.js";

it("keeps deterministic reactivation queue ranking stable after owner migration", () => {
  expect(typeof buildMemberReactivationQueueForBizDate).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/reactivation-features.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/reactivation-push.test.ts src/app/reactivation-execution-service.test.ts`

Expected: FAIL because the owner-path modules do not exist yet.

**Step 3: Write minimal implementation**

- Move reactivation implementations into `src/customer-growth/reactivation/`
- Convert the old root files into re-exports
- Update importing entrypoints:
  - `src/app/reporting-service.ts`
  - `src/app/sync-service.ts`
  - any other direct importers surfaced by `rg`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/reactivation-features.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/reactivation-push.test.ts src/app/reactivation-execution-service.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/customer-growth/reactivation/features.ts src/customer-growth/reactivation/strategy.ts src/customer-growth/reactivation/queue.ts src/customer-growth/reactivation/push.ts src/customer-growth/reactivation/execution-service.ts src/reactivation-features.ts src/reactivation-strategy.ts src/reactivation-queue.ts src/reactivation-push.ts src/app/reactivation-execution-service.ts src/app/reporting-service.ts src/app/sync-service.ts src/reactivation-features.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/reactivation-push.test.ts src/app/reactivation-execution-service.test.ts
git commit -m "refactor: move reactivation pipeline into customer growth owner directory"
```

### Task 4: Introduce Customer Growth AI Config, Contracts, And Shared Client

**Files:**
- Create: `src/customer-growth/ai/contracts.ts`
- Create: `src/customer-growth/ai/client.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `htops.json.example`
- Test: `src/config.test.ts`
- Test: `src/customer-growth/ai/client.test.ts`

**Step 1: Write the failing test**

Add config parsing coverage for a new `customerGrowthAi` config block and a client contract test that verifies invalid JSON fails closed.

```ts
it("parses customerGrowthAi config independently from semanticFallback", () => {
  const config = resolveHetangOpsConfig({
    stores: [{ orgId: "1", storeName: "迎宾店", aliases: [] }],
    customerGrowthAi: {
      enabled: true,
      model: "gpt-5-mini",
      profileInsight: { enabled: true },
    },
  });
  expect(config.customerGrowthAi.enabled).toBe(true);
  expect(config.customerGrowthAi.profileInsight.enabled).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/config.test.ts src/customer-growth/ai/client.test.ts`

Expected: FAIL because `customerGrowthAi` is not defined yet.

**Step 3: Write minimal implementation**

- Add new types in `src/types.ts`
- Parse new config in `src/config.ts`
- Add example config to `htops.json.example`
- Implement a shared OpenAI-compatible client that:
  - is flag-gated
  - times out
  - returns `null` on failure
  - only accepts structured JSON outputs

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/config.test.ts src/customer-growth/ai/client.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/customer-growth/ai/contracts.ts src/customer-growth/ai/client.ts src/types.ts src/config.ts htops.json.example src/config.test.ts src/customer-growth/ai/client.test.ts
git commit -m "feat: add bounded customer growth ai config and client"
```

### Task 5: Add Profile Insight And Strategy Advisor As Bounded Advisory Layers

**Files:**
- Create: `src/customer-growth/ai/profile-insight.ts`
- Create: `src/customer-growth/ai/strategy-advisor.ts`
- Modify: `src/customer-growth/profile.ts`
- Modify: `src/customer-growth/reactivation/strategy.ts`
- Modify: `src/customer-growth/query.ts`
- Modify: `src/tools/handlers.ts`
- Modify: `src/app/reporting-service.ts`
- Test: `src/customer-profile.test.ts`
- Test: `src/reactivation-strategy.test.ts`
- Test: `src/customer-query.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- AI outputs are optional
- deterministic fields remain unchanged
- advisory JSON is attached when AI is enabled

```ts
it("adds profile ai advisory without changing deterministic segment fields", async () => {
  const result = await lookupStructuredCustomerProfile(/* ... */);
  expect(result.matched_members[0]?.current_profile?.primary_segment).toBe("important-reactivation-member");
  expect(result.matched_members[0]).toMatchObject({
    ai_advisory: expect.anything(),
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-profile.test.ts src/reactivation-strategy.test.ts src/customer-query.test.ts`

Expected: FAIL because advisory outputs are not attached yet.

**Step 3: Write minimal implementation**

- Add `profile-insight` module that emits:
  - `profileNarrative`
  - `highValueSignals`
  - `riskSignals`
  - `missingFacts`
- Add `strategy-advisor` module that emits:
  - `contactAngle`
  - `talkingPoints`
  - `offerGuardrails`
  - `doNotPushFlags`
- Persist advisory data only into JSON sidecar payloads
- Expose advisory results through profile/query/reporting/tool output paths

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-profile.test.ts src/reactivation-strategy.test.ts src/customer-query.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/customer-growth/ai/profile-insight.ts src/customer-growth/ai/strategy-advisor.ts src/customer-growth/profile.ts src/customer-growth/reactivation/strategy.ts src/customer-growth/query.ts src/tools/handlers.ts src/app/reporting-service.ts src/customer-profile.test.ts src/reactivation-strategy.test.ts src/customer-query.test.ts
git commit -m "feat: add bounded ai profile and strategy advisory"
```

### Task 6: Add Followup Summarizer And Advisory Rendering For Execution Feedback

**Files:**
- Create: `src/customer-growth/ai/followup-summarizer.ts`
- Modify: `src/customer-growth/reactivation/execution-service.ts`
- Modify: `src/app/reactivation-execution-service.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`
- Test: `src/app/reactivation-execution-service.test.ts`
- Test: `src/reactivation-queue.test.ts`

**Step 1: Write the failing test**

Add a test showing that a raw follow-up note can be summarized into structured advisory output without changing the persisted feedback status logic.

```ts
it("summarizes followup notes into advisory metadata without changing execution status math", async () => {
  const summary = await service.getExecutionSummary({
    orgId: "627149864218629",
    bizDate: "2026-04-19",
  });
  expect(summary.totalTaskCount).toBeGreaterThan(0);
  expect(summary).toMatchObject({
    aiAdvisoryCoverage: expect.anything(),
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/reactivation-execution-service.test.ts src/reactivation-queue.test.ts`

Expected: FAIL because follow-up advisory does not exist yet.

**Step 3: Write minimal implementation**

- Add a bounded summarizer that reads note text and emits:
  - `outcomeSummary`
  - `objectionLabels`
  - `nextBestAction`
  - `followupDraft`
- Keep status aggregation deterministic
- Expose advisory metadata in execution task output where practical

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/reactivation-execution-service.test.ts src/reactivation-queue.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/customer-growth/ai/followup-summarizer.ts src/customer-growth/reactivation/execution-service.ts src/app/reactivation-execution-service.ts src/customer-growth/reactivation/queue.ts src/app/reactivation-execution-service.test.ts src/reactivation-queue.test.ts
git commit -m "feat: add bounded ai followup summarization"
```

### Task 7: Add Observability And End-To-End Verification

**Files:**
- Modify: `src/app/semantic-quality-service.ts`
- Modify: `src/ops/doctor.ts`
- Modify: `src/app/admin-read-service.ts`
- Test: `src/app/semantic-quality-service.test.ts`
- Test: `src/ops/doctor.test.ts`
- Test: `src/app/admin-read-service.test.ts`

**Step 1: Write the failing test**

Add tests that assert customer growth AI config and advisory coverage are visible in control-plane read paths.

```ts
it("surfaces customer growth ai observability in admin and doctor views", async () => {
  expect(renderedText).toContain("customer growth ai");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/semantic-quality-service.test.ts src/ops/doctor.test.ts src/app/admin-read-service.test.ts`

Expected: FAIL because customer growth AI observability is not surfaced yet.

**Step 3: Write minimal implementation**

- Add counters / summaries for:
  - advisory enabled state
  - invocation success/failure
  - coverage by module
- Surface them in doctor/admin summary paths

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/semantic-quality-service.test.ts src/ops/doctor.test.ts src/app/admin-read-service.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/semantic-quality-service.ts src/ops/doctor.ts src/app/admin-read-service.ts src/app/semantic-quality-service.test.ts src/ops/doctor.test.ts src/app/admin-read-service.test.ts
git commit -m "feat: add customer growth ai observability"
```

### Final Verification

Run the targeted suite after all tasks:

```bash
pnpm exec vitest run \
  src/environment-context.test.ts \
  src/customer-intelligence.test.ts \
  src/customer-profile.test.ts \
  src/customer-query.test.ts \
  src/customer-history-backfill.test.ts \
  src/reactivation-features.test.ts \
  src/reactivation-strategy.test.ts \
  src/reactivation-queue.test.ts \
  src/reactivation-push.test.ts \
  src/app/reactivation-execution-service.test.ts \
  src/app/semantic-quality-service.test.ts \
  src/ops/doctor.test.ts \
  src/app/admin-read-service.test.ts \
  src/query-engine-renderer.test.ts \
  src/store-query.test.ts \
  src/app/sync-service.test.ts \
  src/rebuild-customer-history-local-script.test.ts
```

Expected: PASS

If config/bootstrap behavior changes, also run:

```bash
pnpm exec vitest run src/config.test.ts src/query-engine.test.ts src/tools/server.test.ts
```

Expected: PASS
