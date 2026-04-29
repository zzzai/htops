# Phase 1b Production Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close `Phase 1b` by collecting production validation evidence for semantic routing and preparing a safe semantic-default rollout.

**Architecture:** Keep the current `legacy | shadow | semantic` routing modes, but add the production evidence needed to promote `semantic` from “code-ready” to “operationally trusted.” The work splits into three tracks: export a real eval set from bridge audit logs, capture latency baselines from the live ingress path, and compute route accuracy/mismatch review from shadow telemetry before any default-mode change.

**Tech Stack:** TypeScript, Vitest, bridge audit logs, scheduled worker telemetry, shell/journal inspection, local rollout scripts.

---

### Task 1: Freeze the Phase 1b scope

**Files:**
- Reference: `docs/plans/2026-04-13-fast-accurate-realtime-response-plan.md`
- Reference: `src/schedule.ts`
- Reference: `src/sync-orchestrator.ts`

**Definition of done:**
- Semantic routing can be made default only after:
  - real production eval set is exported
  - bridge-to-ready P50/P95 is recorded
  - route accuracy and mismatch classes are reviewed

### Task 2: Export a real production eval set

**Files:**
- Runtime source: bridge inbound audit storage
- Likely references: `src/app/admin-read-service.ts`, inbound audit tables/logs

**Steps:**
1. Export the last 3-7 days of real inbound asks from production bridge audit.
2. Remove pure noise:
   - empty content
   - obvious duplicate retries
   - pure operational chatter with no routing value
3. Label a first batch of 50-100 asks with:
   - expected lane
   - expected intent kind
   - expected store/time-scope completeness
4. Save that batch as the first production eval set.

**Output:**
- `phase1b_eval_set_v1`

### Task 3: Capture ingress latency baseline

**Files:**
- Runtime path references: `src/runtime.ts`, `src/service.ts`, bridge runtime logs

**Steps:**
1. Sample live request timings from bridge ingress to reply-ready point.
2. Record at least:
   - P50
   - P95
   - slow examples with absolute timestamps
3. Separate:
   - cheap meta/clarify/noop cases
   - query cases
   - analysis acknowledgement cases

**Output:**
- first production latency baseline table

### Task 4: Review route accuracy from shadow mode

**Files:**
- Route compare telemetry / shadow logs
- Semantic intent and compare summaries

**Steps:**
1. Pull shadow compare samples for the same eval window.
2. Bucket mismatches by:
   - wrong lane
   - wrong intent kind
   - missing clarification
   - store/time-scope misread
3. Compute first route-accuracy snapshot.
4. Identify top 5 mismatch patterns by frequency.

**Output:**
- `phase1b_route_accuracy_v1`
- top mismatch list

### Task 5: Gate semantic-default rollout

**Files:**
- Config/runtime rollout path

**Steps:**
1. Do not switch semantic default until Tasks 2-4 are complete.
2. When accuracy is acceptable, switch by staged rollout:
   - small-scope semantic default
   - observe mismatch/latency
   - expand gradually
3. Keep rollback to `routing.mode=shadow` or `legacy` explicit.

**Output:**
- semantic-default rollout readiness decision

### Task 6: Today’s execution order

**Order:**
1. Export real inbound asks
2. Build the first eval set
3. Capture P50/P95
4. Review shadow mismatch categories
5. Decide whether semantic-default gray rollout is allowed

### Verification

Run and verify:
- production audit export command or SQL
- latency sampling command/log extraction
- route compare summary generation command

The rollout is **not complete** until the evidence exists in production, not just in code.
