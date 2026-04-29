# Hetang Bounded Analysis Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a bounded four-stage analysis pipeline so async deep analysis becomes deterministic-first, stage-observable, and safer under sidecar failure.

**Architecture:** Keep analysis orchestration inside `htops`. Reuse the existing evidence-pack stage, add a deterministic diagnostic-signal stage in a dedicated owner module, keep model usage limited to bounded synthesis, and normalize action items before delivery. Query lane behavior and `src/runtime.ts` responsibilities must not expand.

**Tech Stack:** TypeScript, Vitest, existing analysis service/orchestrator modules, local Python sidecar wrapper, OpenAI-compatible chat completions, deterministic evidence packs.

---

### Task 1: Introduce bounded analysis stage contracts

**Files:**
- Modify: `src/types.ts`
- Modify: `src/app/analysis-service.ts`
- Test: `src/app/analysis-service.test.ts`

**Step 1: Write the failing test**

Add a test that expects the analysis service result payload to preserve orchestration metadata when bounded analysis completes.

```ts
it("records bounded orchestration metadata in the raw result payload", async () => {
  const result = await service.runCrewAISidecar(buildJob());
  const parsed = JSON.parse(result);
  expect(parsed.orchestration).toEqual(
    expect.objectContaining({
      version: "v1",
      completedStages: expect.arrayContaining(["evidence_pack", "diagnostic_signals"]),
    }),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/analysis-service.test.ts -t "records bounded orchestration metadata in the raw result payload"`

Expected: FAIL because no orchestration metadata exists yet.

**Step 3: Write minimal implementation**

Add bounded orchestration types in `src/types.ts` and start returning an `orchestration` object in the raw JSON result from `analysis-service`.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/analysis-service.test.ts -t "records bounded orchestration metadata in the raw result payload"`

Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/app/analysis-service.ts src/app/analysis-service.test.ts
git commit -m "feat: add bounded analysis orchestration metadata"
```

### Task 2: Add deterministic diagnostic signal builder

**Files:**
- Create: `src/app/analysis-diagnostic-service.ts`
- Modify: `src/types.ts`
- Test: `src/app/analysis-diagnostic-service.test.ts`

**Step 1: Write the failing test**

Create a test that builds signals from a known evidence pack and expects stable findings for point clock, add clock, and member silence.

```ts
it("derives deterministic diagnostic signals from a single-store evidence pack", () => {
  const bundle = buildHetangDiagnosticBundle(evidencePack);
  expect(bundle.signals.map((signal) => signal.signalId)).toEqual(
    expect.arrayContaining([
      "point_clock_risk",
      "add_clock_weakness",
      "member_silence_risk",
    ]),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/analysis-diagnostic-service.test.ts`

Expected: FAIL because the module does not exist yet.

**Step 3: Write minimal implementation**

Create `src/app/analysis-diagnostic-service.ts` with deterministic signal rules over `HetangAnalysisEvidencePack`.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/analysis-diagnostic-service.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/analysis-diagnostic-service.ts src/app/analysis-diagnostic-service.test.ts src/types.ts
git commit -m "feat: add deterministic analysis diagnostic signals"
```

### Task 3: Orchestrate stage order inside analysis service

**Files:**
- Modify: `src/app/analysis-service.ts`
- Modify: `src/app/analysis-execution-service.ts`
- Test: `src/app/analysis-service.test.ts`

**Step 1: Write the failing test**

Add a test that verifies stage order is `evidence_pack -> diagnostic_signals -> bounded_synthesis`.

```ts
it("runs bounded analysis stages in order", async () => {
  const calls: string[] = [];
  const result = await service.runCrewAISidecar(buildJob());
  expect(calls).toEqual([
    "evidence_pack",
    "diagnostic_signals",
    "bounded_synthesis",
  ]);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/analysis-service.test.ts -t "runs bounded analysis stages in order"`

Expected: FAIL because there is no explicit stage controller yet.

**Step 3: Write minimal implementation**

Make `analysis-service` explicitly build the evidence pack, then diagnostic bundle, then synthesis input. Keep `analysis-execution-service` as the owner of evidence-pack creation only.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/analysis-service.test.ts -t "runs bounded analysis stages in order"`

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/analysis-service.ts src/app/analysis-execution-service.ts src/app/analysis-service.test.ts
git commit -m "feat: orchestrate bounded analysis stages in service"
```

### Task 4: Feed diagnostic bundle into local sidecar and local fallback

**Files:**
- Modify: `src/app/analysis-service.ts`
- Modify: `tools/crewai-sidecar/store_review.py`
- Test: `src/app/analysis-service.test.ts`
- Test: `src/app/analysis-local-sidecar.test.ts`

**Step 1: Write the failing test**

Add tests expecting a diagnostic bundle env var to be passed to the sidecar and returned in `--print-context`.

```ts
expect(runCommandWithTimeout).toHaveBeenCalledWith(
  expect.any(Array),
  expect.objectContaining({
    env: expect.objectContaining({
      HETANG_ANALYSIS_DIAGNOSTIC_JSON: expect.any(String),
    }),
  }),
);
```

```ts
expect(parsed.diagnostic_bundle).toEqual(
  expect.objectContaining({
    signals: expect.any(Array),
  }),
);
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts src/app/analysis-local-sidecar.test.ts
```

Expected: FAIL because no diagnostic env var is passed yet.

**Step 3: Write minimal implementation**

Pass a compact diagnostic bundle JSON env var from `analysis-service` into the sidecar. Update the local Python wrapper to expose that bundle in `--print-context` and to use it in deterministic fallback copy.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts src/app/analysis-local-sidecar.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/analysis-service.ts tools/crewai-sidecar/store_review.py src/app/analysis-service.test.ts src/app/analysis-local-sidecar.test.ts
git commit -m "feat: pass diagnostic bundle into bounded analysis sidecar"
```

### Task 5: Normalize action items from structured analysis output first

**Files:**
- Modify: `src/app/analysis-service.ts`
- Modify: `src/analysis-result.ts`
- Test: `src/app/analysis-service.test.ts`
- Test: `src/analysis-result.test.ts`

**Step 1: Write the failing test**

Add a test where the result payload contains structured action items and verify auto-create logic uses them before falling back to regex extraction.

```ts
it("prefers structured action items over text scraping", async () => {
  const createdCount = await service.autoCreateActionsFromAnalysis(jobWithStructuredActions);
  expect(createdCount).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts src/analysis-result.test.ts
```

Expected: FAIL because action items are still text-derived first.

**Step 3: Write minimal implementation**

Teach analysis result parsing to read structured action items if present, and update action auto-creation to prefer them.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts src/analysis-result.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/app/analysis-service.ts src/analysis-result.ts src/app/analysis-service.test.ts src/analysis-result.test.ts
git commit -m "feat: normalize structured analysis action items"
```

### Task 6: Verify bounded fallback behavior and regression safety

**Files:**
- Modify: `src/app/analysis-service.test.ts`
- Modify: `src/analysis-orchestrator.test.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write the failing test**

Add a test that forces bounded synthesis failure and expects:

- safe markdown still exists
- orchestration metadata shows fallback stage
- no empty delivery text

```ts
expect(parsed.orchestration.fallbackStage).toBe("bounded_synthesis");
expect(parsed.markdown).toContain("结论摘要");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts src/analysis-orchestrator.test.ts
```

Expected: FAIL because fallback stage metadata is not wired yet.

**Step 3: Write minimal implementation**

Finish fallback metadata propagation and ensure orchestrator delivery still behaves the same for completed jobs.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/app/analysis-service.test.ts src/analysis-orchestrator.test.ts
```

Expected: PASS

**Step 5: Run broader regression**

Run:

```bash
pnpm exec vitest run src/app/analysis-local-sidecar.test.ts src/app/analysis-service.test.ts src/app/analysis-execution-service.test.ts src/analysis-orchestrator.test.ts src/runtime.test.ts
pnpm exec vitest run src/query-engine.test.ts src/query-engine-modules.test.ts src/capability-graph.test.ts src/query-plan.test.ts src/semantic-intent.test.ts src/inbound.test.ts src/inbound-semantic-front-door.test.ts src/app/message-entry-service.test.ts src/query-intent.test.ts src/route-eval.test.ts src/route-compare-summary.test.ts src/analysis-orchestrator.test.ts src/app/analysis-execution-service.test.ts src/app/analysis-service.test.ts src/runtime.test.ts
```

Expected: all green

**Step 6: Commit**

```bash
git add src/app/analysis-service.test.ts src/analysis-orchestrator.test.ts
git commit -m "test: verify bounded analysis fallback and regressions"
```

---

## Notes For The Implementer

- Do not add business routing into `src/runtime.ts`
- Keep deterministic logic in TypeScript owner modules, not in the sidecar
- Keep sidecar responsibilities limited to bounded synthesis and compatible local fallback
- If a schema migration becomes necessary for observability, stop and write a small follow-up design instead of sneaking it into this slice

---

## Verification Standard

Do not claim completion until:

- new bounded analysis tests pass
- existing analysis/runtime tests pass
- the wider 15-file regression suite stays green
- direct evidence-backed local sidecar invocation still returns a valid JSON payload
