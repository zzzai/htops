# Hermes / htops Runtime Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `荷塘小助手` run only on Hermes in production, remove OpenClaw from the active runtime path, and add the first stable htops business tool facade that Hermes can call without relying only on the inbound bridge.

**Architecture:** First harden the runtime boundary: disable OpenClaw self-start, remove stale watchdog recovery paths, and make Hermes startup log the active runtime home, bridge mode, and bot identity summary. Then add a narrow `htops-tools` HTTP/tool facade beside the existing inbound bridge so Hermes can plan on top while htops still owns deterministic business execution.

**Tech Stack:** TypeScript, Python gateway overrides, Vitest, systemd service scripts, Hermes gateway, PostgreSQL-backed htops runtime

---

### Task 1: Lock the runtime-routing contract with tests

**Files:**
- Modify: `hermes_overrides/test_htops_router.py`
- Modify: `src/app/message-entry-service.test.ts`

**Step 1: Write the failing test**

Add coverage proving:

- general chat stays on Hermes
- business/store questions route to htops
- slash commands are never claimed by the Hermes bridge patch

**Step 2: Run test to verify it fails**

Run:

```bash
python3 -m pytest hermes_overrides/test_htops_router.py -q
pnpm test -- src/app/message-entry-service.test.ts
```

Expected: FAIL once new route logging / route classification assertions are added.

**Step 3: Write minimal implementation**

Extend router/entry tests to assert the explicit route categories we want to standardize.

**Step 4: Run test to verify it passes**

Run:

```bash
python3 -m pytest hermes_overrides/test_htops_router.py -q
pnpm test -- src/app/message-entry-service.test.ts
```

Expected: PASS

### Task 2: Remove OpenClaw from the active recovery path

**Files:**
- Modify: `ops/hetang-gateway-watchdog.sh`
- Modify: `.env.runtime`
- Modify: `README.md`

**Step 1: Write the failing test**

Add a shell-level or unit-level test proving watchdog refuses to recover `openclaw-gateway.service` for the htops runtime path and only targets Hermes when recovery is enabled.

**Step 2: Run test to verify it fails**

Run the targeted test if added, or run a scripted dry-run verification that shows OpenClaw is still considered a recovery target.

Expected: FAIL because current runtime env still points watchdog to `openclaw-gateway.service`.

**Step 3: Write minimal implementation**

- remove stale OpenClaw recovery env defaults from `.env.runtime`
- harden watchdog to no-op or fail-fast when pointed at OpenClaw from the htops runtime path
- document that OpenClaw is now compatibility-only

**Step 4: Run test to verify it passes**

Run the targeted watchdog verification again.

Expected: PASS

### Task 3: Add Hermes startup identity and route-mode logging

**Files:**
- Modify: `ops/hermes-gateway.sh`
- Modify: `hermes_overrides/sitecustomize.py`
- Test: new test under `src` or `hermes_overrides` if practical

**Step 1: Write the failing test**

Add a test or harness assertion expecting startup/runtime logs to include:

- runtime home
- bridge URL
- route mode
- bot id suffix or identity summary

**Step 2: Run test to verify it fails**

Run the targeted test/harness.

Expected: FAIL because startup currently does not emit these normalized identity lines.

**Step 3: Write minimal implementation**

- emit normalized startup lines in `ops/hermes-gateway.sh`
- emit route category logs in `sitecustomize.py`

**Step 4: Run test to verify it passes**

Run the targeted test/harness.

Expected: PASS

### Task 4: Add a narrow htops business tool facade contract

**Files:**
- Create: `src/tools/contracts.ts`
- Create: `src/tools/server.ts`
- Create: `src/tools/server.test.ts`
- Modify: `scripts/run-bridge-service.ts` or add `scripts/run-tools-service.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

Add tests for a new narrow tool surface with the first operations:

- `get_store_daily_summary`
- `get_member_recall_candidates`
- `get_customer_profile`
- `get_store_risk_scan`
- `explain_metric_definition`

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/tools/server.test.ts
```

Expected: FAIL because the tool server and contracts do not exist yet.

**Step 3: Write minimal implementation**

Create a token-protected localhost-only tool surface that maps tool requests onto existing htops runtime/query capabilities.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/tools/server.test.ts
```

Expected: PASS

### Task 5: Implement `get_store_daily_summary` and `explain_metric_definition`

**Files:**
- Modify: `src/runtime.ts`
- Create or modify: `src/tools/handlers.ts`
- Modify: `src/tools/server.test.ts`

**Step 1: Write the failing test**

Add handler tests proving:

- a valid store/date request returns structured daily summary data
- a valid metric name returns deterministic definition metadata

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/tools/server.test.ts -t "store daily summary"
pnpm test -- src/tools/server.test.ts -t "metric definition"
```

Expected: FAIL

**Step 3: Write minimal implementation**

Map these tool calls to existing runtime/store/query paths without introducing new SQL generation by AI.

**Step 4: Run test to verify it passes**

Run the same tests again.

Expected: PASS

### Task 6: Implement `get_member_recall_candidates`, `get_customer_profile`, and `get_store_risk_scan`

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/tools/handlers.ts`
- Modify: `src/tools/server.test.ts`

**Step 1: Write the failing test**

Add handler tests proving each tool returns structured JSON from existing htops capabilities.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/tools/server.test.ts -t "member recall"
pnpm test -- src/tools/server.test.ts -t "customer profile"
pnpm test -- src/tools/server.test.ts -t "store risk scan"
```

Expected: FAIL

**Step 3: Write minimal implementation**

Wire each tool to existing runtime/query paths and return stable structured outputs.

**Step 4: Run test to verify it passes**

Run the same tests again.

Expected: PASS

### Task 7: Keep outbound delivery pinned to Hermes only

**Files:**
- Modify: `src/notify.ts`
- Modify: `src/hermes-send.ts`
- Modify: `src/notify.test.ts`
- Modify: `src/hermes-send.test.ts`

**Step 1: Write the failing test**

Add tests proving standalone outbound delivery does not fall back to OpenClaw runtime assumptions for the active production path.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/notify.test.ts src/hermes-send.test.ts
```

Expected: FAIL if any OpenClaw-specific fallback is still assumed on the active path.

**Step 3: Write minimal implementation**

Tighten Hermes-only outbound assumptions for the active runtime while preserving OpenClaw compatibility as an explicit fallback path, not the default production path.

**Step 4: Run test to verify it passes**

Run the same tests again.

Expected: PASS

### Task 8: Add operational verification scripts and docs

**Files:**
- Modify: `README.md`
- Optionally create: `scripts/check-hermes-runtime.ts`

**Step 1: Write the failing test**

Add a small verification script or documented checklist that validates:

- Hermes is the only active gateway
- OpenClaw service is disabled
- bridge is healthy
- tool facade is healthy
- outbound send path resolves to Hermes

**Step 2: Run verification to prove the old state still fails**

Run the checklist/script before the final changes.

Expected: FAIL on one or more old runtime assumptions.

**Step 3: Write minimal implementation**

Add the script or exact documented checks.

**Step 4: Run verification to prove the new state passes**

Run the same verification again.

Expected: PASS

### Task 9: Run focused verification

**Files:**
- Test: `hermes_overrides/test_htops_router.py`
- Test: `src/app/message-entry-service.test.ts`
- Test: `src/tools/server.test.ts`
- Test: `src/notify.test.ts`
- Test: `src/hermes-send.test.ts`

**Step 1: Run the focused suite**

Run:

```bash
python3 -m pytest hermes_overrides/test_htops_router.py -q
pnpm test -- src/app/message-entry-service.test.ts src/tools/server.test.ts src/notify.test.ts src/hermes-send.test.ts
```

Expected: PASS

**Step 2: Run build/type verification**

Run:

```bash
pnpm build
```

Expected: PASS

**Step 3: Run service-level checks**

Run exact operational checks after deploy:

```bash
systemctl is-active hermes-gateway.service
systemctl is-enabled hermes-gateway.service
systemctl is-enabled openclaw-gateway.service
curl -fsS http://127.0.0.1:18891/health
```

Expected:

- Hermes active
- OpenClaw disabled
- bridge healthy

### Task 10: Rollout summary

**Files:**
- None required

**Step 1: Document final state**

Summarize:

- which service owns `荷塘小助手`
- whether OpenClaw is disabled
- where runtime logs live
- which htops business tools are now callable by Hermes

**Step 2: Note remaining Phase 2 work**

Record that the next stage is Hermes sidecar support for external intelligence, web acquisition, and other asynchronous advanced workflows, explicitly outside the core KPI query path.
