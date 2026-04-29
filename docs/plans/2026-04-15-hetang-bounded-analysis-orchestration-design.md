# Hetang Bounded Analysis Orchestration Design

**Status:** Approved

**Date:** 2026-04-15

**Owner Area:** `Phase 5` analysis lane

---

## Goal

Upgrade async analysis from:

`evidence pack -> single prompt / local fallback`

to:

`evidence pack -> deterministic diagnostic signals -> bounded synthesis -> structured action items -> final reply`

without polluting the fast query lane and without adding new business entry logic into `src/runtime.ts`.

---

## Why This Change

The current analysis lane already has the correct outer boundary:

- analysis stays async-only
- evidence packs are deterministic
- sidecar failure falls back safely

The remaining weakness is inside the analysis worker itself. After the evidence pack is built, the current path still depends mostly on one prompt or one local fallback. That creates three problems:

1. diagnosis quality is hard to stabilize because all reasoning is compressed into one generation step
2. failure handling is coarse because we only know the whole analysis failed, not which stage failed
3. action items are downstream text extraction, not the result of a bounded pipeline

The bounded orchestration design fixes that by keeping a fixed stage graph inside `htops`, while still allowing the sidecar to help only in the synthesis stage.

---

## Non-Goals

- no change to the `query` lane contract
- no new DB schema in the first slice unless observability forces it later
- no unbounded agent loop
- no free-form tool planning inside the sidecar
- no move of business entry responsibilities into `src/runtime.ts`

---

## Recommended Architecture

### Chosen Approach

Keep the orchestration controller inside `htops`, not inside the sidecar.

The analysis lane becomes a fixed four-stage pipeline:

1. `evidence_pack`
2. `diagnostic_signals`
3. `bounded_synthesis`
4. `action_items`

The first two stages are deterministic and testable. The third stage is the only one allowed to use a model sidecar. The fourth stage normalizes action items and final output into a stable structure.

### Why This Approach

- it preserves `htops` as the source of truth for stage order and fallback behavior
- it keeps the sidecar replaceable
- it makes stage-level failures inspectable
- it narrows the model’s role from “do everything” to “synthesize from bounded inputs”

---

## Alternatives Considered

### Option A: Put the whole orchestration inside the sidecar

Rejected.

This is the fastest short-term implementation, but it weakens observability and rollback. The sidecar becomes the only place that knows stage order, making failures and quality regressions harder to isolate.

### Option B: Keep the current evidence pack flow and only improve prompts

Rejected.

This helps output quality a bit, but it does not create real stage boundaries. Failure behavior, action item quality, and testability remain weak.

### Option C: Full DAG / multi-agent orchestration now

Rejected for now.

This adds complexity before the bounded four-stage pipeline is stable. The project is not ready for unbounded planning in a high-trust, fact-constrained business system.

---

## Stage Design

### Stage 1: `evidence_pack`

**Owner:** `src/app/analysis-execution-service.ts`

Use the existing deterministic pack builder as the only fact source.

Output shape:

- scope metadata
- question metadata
- compact markdown evidence
- raw facts needed by downstream diagnostic rules

This stage already exists and becomes the formal entry artifact for all later stages.

### Stage 2: `diagnostic_signals`

**Owner:** new owner module, not `runtime.ts`

Generate deterministic signals from the evidence pack before any model call.

Example signal families:

- `revenue_trend`
- `clock_efficiency`
- `point_clock_risk`
- `add_clock_weakness`
- `member_silence_risk`
- `conversion_chain_gap`
- `data_completeness_risk`

Each signal should include:

- `signalId`
- `severity`
- `title`
- `finding`
- `evidence`
- optional `recommendedFocus`

This gives the synthesis stage a bounded, opinionated diagnostic substrate instead of raw facts only.

### Stage 3: `bounded_synthesis`

**Owner:** `src/app/analysis-service.ts` + local/sibling sidecar boundary

The model stage is allowed to do only three things:

- prioritize deterministic signals
- explain likely business root causes
- produce structured summary and recommendations

The model stage is **not** allowed to:

- invent new facts
- expand scope
- call tools
- alter evidence numbers

Inputs:

- evidence pack
- diagnostic signals
- strict JSON output contract

Outputs:

- `summary`
- `risks`
- `suggestions`
- `markdown`
- optional stage metadata such as prioritized signal ids

If the model stage is unavailable, local fallback uses the same evidence pack and diagnostic signals to produce a deterministic review.

### Stage 4: `action_items`

**Owner:** `src/app/analysis-service.ts`

Normalize the output into structured action items before delivery and before auto-creation.

The action item stage should:

- derive stable suggested actions from structured output first
- fall back to text extraction only if structured fields are missing
- preserve current `autoCreateActionsFromAnalysis()` semantics

This stage is also the right place to attach orchestration metadata into the raw stored result payload for later inspection.

---

## Data Flow

The internal flow becomes:

`job -> evidence pack -> diagnostic signals -> synthesis request -> synthesis result -> normalized action items -> final stored result -> delivery`

Recommended internal artifact names:

- `HetangAnalysisEvidencePack`
- `HetangAnalysisDiagnosticSignal`
- `HetangAnalysisDiagnosticBundle`
- `HetangBoundedAnalysisResult`

These artifacts should stay internal to the analysis lane and not leak into the query lane contract.

---

## Module Boundaries

### Keep

- `src/app/analysis-execution-service.ts`
  - fact collection
  - scope resolution
  - deterministic evidence assembly

- `src/app/analysis-service.ts`
  - bounded orchestration controller
  - stage fallback policy
  - sidecar invocation
  - action item normalization

- `src/analysis-orchestrator.ts`
  - queue / run / delivery lifecycle

### Add

- `src/app/analysis-diagnostic-service.ts`
  - deterministic signal builder from evidence pack

This avoids growing `analysis-service.ts` into another monolith and matches the repo rule of preferring owner modules.

---

## Failure Policy

Failure handling must remain stage-bounded:

- `evidence_pack` fails:
  - analysis job fails normally
- `diagnostic_signals` fails:
  - degrade to evidence-only fallback
- `bounded_synthesis` fails:
  - degrade to deterministic local synthesis from evidence + signals
- `action_items` normalization fails:
  - deliver summary markdown anyway, skip auto-created actions

The key rule is:

**deep analysis may degrade, but it must not become silent, empty, or unsafe.**

---

## Observability

First slice observability should not require schema migration.

Minimum observability requirements:

- log stage start / success / fallback / failure
- preserve `review_mode`
- include a lightweight `orchestration` object in the raw JSON result payload when available

Suggested payload fields:

- `orchestration.version`
- `orchestration.completedStages`
- `orchestration.fallbackStage`
- `orchestration.signalCount`

This gives enough auditability before deciding whether to persist stage rows in dedicated tables.

---

## Testing Strategy

### Unit tests

- diagnostic signal generation from single-store evidence packs
- deterministic synthesis fallback from signals
- stage failure downgrade behavior
- action item normalization prefers structured output

### Integration tests

- `analysis-service` runs stages in the correct order
- local repo sidecar receives evidence pack plus diagnostic signal bundle
- sibling sidecar fallback still works when no local sidecar exists

### Regression requirement

The existing analysis and runtime suites must stay green. Query latency and fast-lane routing must remain untouched by this change.

---

## Rollout Strategy

Roll out in two slices.

### Slice 1

- formalize stage types
- add deterministic diagnostic signals
- add bounded controller in `analysis-service`
- keep current local sidecar compatibility
- keep current fallback behavior

### Slice 2

- enrich sidecar prompt with diagnostic bundle
- normalize structured action items
- attach orchestration metadata to raw result JSON

This keeps risk low while still making the analysis lane materially more reliable.

---

## Exit Criteria

This design is complete when:

- analysis runs through explicit bounded stages
- at least one deterministic diagnostic bundle is generated before any model call
- deep analysis failure still returns safe scoped output
- action items come from bounded output normalization first, not raw text scraping first
- existing query and runtime regression suites remain green
