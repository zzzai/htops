# Hermes Conversation Review Control Plane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a nightly conversation-review control plane that turns real inbound asks, shadow mismatches, analysis fallback metadata, and user corrections into structured findings and suggested actions.

**Architecture:** Keep query and execution deterministic inside `htops`, and use Hermes only inside a bounded offline review lane. Store review runs and findings in the queue/access-control owner surface, run the review from the scheduled worker, and expose summaries through admin-read instead of directly changing production behavior.

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, scheduled worker control plane, existing inbound audit tables, analysis orchestration metadata, optional shadow telemetry adapters.

---

### Task 1: Introduce conversation-review types and schema

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/store/queue-access-control-store.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

Add a store test that expects the database bootstrap to create `conversation_review_runs` and `conversation_review_findings`, and that a review run plus one finding can round-trip through the store.

```ts
it("stores conversation review runs and findings", async () => {
  await store.createConversationReviewRun({
    reviewRunId: "run-1",
    reviewDate: "2026-04-16",
    sourceWindowStart: "2026-04-15T00:00:00.000Z",
    sourceWindowEnd: "2026-04-16T00:00:00.000Z",
    status: "completed",
    inputConversationCount: 12,
    inputShadowSampleCount: 4,
    inputAnalysisJobCount: 2,
    findingCount: 1,
    createdAt: now,
    updatedAt: now,
  });

  await store.createConversationReviewFinding({
    findingId: "finding-1",
    reviewRunId: "run-1",
    findingType: "scope_gap",
    severity: "high",
    confidence: 0.96,
    title: "缺少时间范围",
    summary: "用户问这几天但系统没有按默认5天解释。",
    evidenceJson: JSON.stringify({ rawText: "这几天义乌店加钟率多少" }),
    status: "open",
    createdAt: now,
  });

  const runs = await store.listConversationReviewRuns({ limit: 5 });
  const findings = await store.listConversationReviewFindings({ reviewRunId: "run-1" });
  expect(runs[0]?.reviewRunId).toBe("run-1");
  expect(findings[0]?.findingType).toBe("scope_gap");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/store.test.ts -t "stores conversation review runs and findings"
```

Expected: FAIL because the schema and store methods do not exist yet.

**Step 3: Write minimal implementation**

- Add new type definitions for `HetangConversationReviewRun`, `HetangConversationReviewFinding`, `HetangConversationReviewFindingType`, and status enums in `src/types.ts`
- Create both tables in `src/store.ts`
- Add minimal CRUD methods in `src/store.ts`
- Thread those methods through `src/store/queue-access-control-store.ts`

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/store.test.ts -t "stores conversation review runs and findings"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/store.ts src/store/queue-access-control-store.ts src/store.test.ts
git commit -m "feat: add conversation review run and finding storage"
```

### Task 2: Build deterministic review finding classification

**Files:**
- Create: `src/app/conversation-review-finding-service.ts`
- Modify: `src/types.ts`
- Test: `src/app/conversation-review-finding-service.test.ts`

**Step 1: Write the failing test**

Create a test that feeds inbound audit rows, analysis fallback metadata, and a user correction turn into the classifier and expects stable finding candidates.

```ts
it("derives deterministic review findings from audit and fallback signals", () => {
  const result = buildConversationReviewFindingCandidates({
    inboundAudits: [
      {
        requestId: "req-1",
        channel: "wecom",
        senderId: "u-1",
        conversationId: "chat-1",
        isGroup: false,
        content: "这几天义乌店加钟率多少",
        receivedAt: "2026-04-16T10:00:00.000Z",
      },
    ],
    analysisSignals: [
      {
        jobId: "job-1",
        fallbackStage: "bounded_synthesis",
      },
    ],
    shadowSignals: [],
  });

  expect(result.findings.map((item) => item.findingType)).toEqual(
    expect.arrayContaining(["scope_gap", "analysis_gap"]),
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/conversation-review-finding-service.test.ts
```

Expected: FAIL because the module does not exist yet.

**Step 3: Write minimal implementation**

Create a deterministic classifier that can emit at least these first-slice findings:

- `scope_gap`
- `reply_quality_issue`
- `analysis_gap`
- `memory_candidate`

The implementation should stay deterministic-first and return normalized candidate payloads with evidence JSON.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/app/conversation-review-finding-service.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/conversation-review-finding-service.ts src/app/conversation-review-finding-service.test.ts src/types.ts
git commit -m "feat: add deterministic conversation review classifier"
```

### Task 3: Add the conversation-review run service

**Files:**
- Create: `src/app/conversation-review-service.ts`
- Modify: `src/store/queue-access-control-store.ts`
- Modify: `src/app/admin-read-service.ts`
- Test: `src/app/conversation-review-service.test.ts`
- Test: `src/app/admin-read-service.test.ts`

**Step 1: Write the failing test**

Add a service test that expects one review run to:

- collect source rows
- persist a review run
- persist normalized findings
- produce a summary JSON payload

```ts
it("persists a completed conversation review run with findings and summary", async () => {
  const result = await service.runNightlyConversationReview({
    reviewDate: "2026-04-16",
    sourceWindowStart: "2026-04-15T00:00:00.000Z",
    sourceWindowEnd: "2026-04-16T00:00:00.000Z",
  });

  expect(result.findingCount).toBe(2);
  expect(queueStore.createConversationReviewRun).toHaveBeenCalled();
  expect(queueStore.createConversationReviewFinding).toHaveBeenCalledTimes(2);
  expect(result.summary.topFindingTypes).toContain("scope_gap");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/conversation-review-service.test.ts
```

Expected: FAIL because the orchestration service does not exist yet.

**Step 3: Write minimal implementation**

- Add a review-run service that reads inbound audits and analysis jobs from the queue/control-plane store
- Call the deterministic classifier
- Persist the run first, then the findings, then the summary JSON
- Add a small admin-read method to fetch the latest review summary and unresolved high-severity findings

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/app/conversation-review-service.test.ts src/app/admin-read-service.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/conversation-review-service.ts src/app/conversation-review-service.test.ts src/app/admin-read-service.ts src/app/admin-read-service.test.ts src/store/queue-access-control-store.ts
git commit -m "feat: add conversation review run service"
```

### Task 4: Add bounded review synthesis for prioritization only

**Files:**
- Modify: `src/app/conversation-review-service.ts`
- Modify: `src/types.ts`
- Test: `src/app/conversation-review-service.test.ts`

**Step 1: Write the failing test**

Add a test that expects the review service to preserve deterministic findings even when bounded synthesis is unavailable, and to enrich them with prioritized summaries when synthesis succeeds.

```ts
it("falls back to deterministic-only review findings when synthesis is unavailable", async () => {
  const result = await service.runNightlyConversationReview(window);
  expect(result.summary.reviewMode).toBe("deterministic-only");
  expect(result.findings[0]?.findingType).toBe("scope_gap");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/conversation-review-service.test.ts -t "falls back to deterministic-only review findings when synthesis is unavailable"
```

Expected: FAIL because no bounded synthesis stage exists yet.

**Step 3: Write minimal implementation**

- Add an optional bounded synthesis stage inside the review service
- Restrict model usage to prioritization, root-cause wording, and suggested action typing
- Never allow the synthesis stage to replace deterministic evidence or introduce new business facts

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/app/conversation-review-service.test.ts -t "falls back to deterministic-only review findings when synthesis is unavailable"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/conversation-review-service.ts src/app/conversation-review-service.test.ts src/types.ts
git commit -m "feat: bound conversation review synthesis to prioritization"
```

### Task 5: Schedule the nightly conversation review job

**Files:**
- Modify: `src/types.ts`
- Modify: `src/control-plane-contract.json`
- Modify: `src/schedule.ts`
- Modify: `src/app/sync-service.ts`
- Test: `src/schedule.test.ts`
- Test: `src/sync-orchestrator.test.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write the failing test**

Add tests expecting a new scheduler job type `nightly-conversation-review` to appear in the authoritative catalog and execute from the sync orchestrator.

```ts
expect(status.jobs.some((job) => job.jobType === "nightly-conversation-review")).toBe(true);
```

```ts
const lines = await runtime.runDueJobs(new Date("2026-04-16T04:20:00+08:00"));
expect(lines).toContain("conversation review completed");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/schedule.test.ts src/sync-orchestrator.test.ts src/runtime.test.ts
```

Expected: FAIL because no scheduler job exists yet.

**Step 3: Write minimal implementation**

- Add `nightly-conversation-review` into `ScheduledJobType`
- Register it in `src/control-plane-contract.json`
- Add the schedule definition in `src/schedule.ts`
- Invoke the conversation-review service from `src/app/sync-service.ts`
- Keep it on the scheduled worker path, not the analysis worker path

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/schedule.test.ts src/sync-orchestrator.test.ts src/runtime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/control-plane-contract.json src/schedule.ts src/app/sync-service.ts src/schedule.test.ts src/sync-orchestrator.test.ts src/runtime.test.ts
git commit -m "feat: schedule nightly conversation review job"
```

### Task 6: Expose review summaries and suggested actions safely

**Files:**
- Modify: `src/app/admin-read-service.ts`
- Modify: `src/command.ts`
- Test: `src/app/admin-read-service.test.ts`
- Test: `src/command.test.ts`

**Step 1: Write the failing test**

Add tests expecting the control plane to show:

- latest review run
- top unresolved high-severity findings
- suggested action counts grouped by action type

```ts
it("shows latest conversation review summary and top finding types", async () => {
  const summary = await service.getConversationReviewSummary();
  expect(summary.latestRun?.findingCount).toBe(5);
  expect(summary.topFindingTypes[0]?.findingType).toBe("scope_gap");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/admin-read-service.test.ts src/command.test.ts
```

Expected: FAIL because no review summary surface exists yet.

**Step 3: Write minimal implementation**

- Add read-only summary APIs in `admin-read-service`
- Render the summary in the command surface without auto-creating `action_center_items`
- Keep suggested actions as review output only in the first slice

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/app/admin-read-service.test.ts src/command.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/admin-read-service.ts src/app/admin-read-service.test.ts src/command.ts src/command.test.ts
git commit -m "feat: expose conversation review summaries"
```

### Task 7: Run focused verification and rollout checks

**Files:**
- Reference: `src/store.ts`
- Reference: `src/app/conversation-review-service.ts`
- Reference: `src/app/sync-service.ts`
- Reference: `src/app/admin-read-service.ts`

**Step 1: Run store and review service tests**

Run:

```bash
pnpm exec vitest run \
  src/store.test.ts \
  src/app/conversation-review-finding-service.test.ts \
  src/app/conversation-review-service.test.ts
```

Expected: PASS

**Step 2: Run scheduler and control-plane surface tests**

Run:

```bash
pnpm exec vitest run \
  src/schedule.test.ts \
  src/sync-orchestrator.test.ts \
  src/runtime.test.ts \
  src/app/admin-read-service.test.ts \
  src/command.test.ts
```

Expected: PASS

**Step 3: Run repo doctor if scheduler / control-plane contract changed**

Run:

```bash
npm run codex:doctor
```

Expected: PASS

**Step 4: Manual rollout checks**

Verify in staging or production-read mode:

- one `nightly-conversation-review` run is created
- findings persist without blocking reports or sync jobs
- review summary is queryable
- no business reply path latency regresses

**Step 5: Commit**

```bash
git add .
git commit -m "chore: verify conversation review control plane rollout"
```

---

Plan complete and saved to `docs/plans/2026-04-16-hermes-conversation-review-control-plane-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
