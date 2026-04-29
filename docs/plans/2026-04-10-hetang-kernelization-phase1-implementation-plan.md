# Hetang Kernelization Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a first-class `access-context` layer, thin the runtime into a real runtime shell, and pull the serving-query boundary out of the current monolithic runtime/store flow without changing the product behavior.

**Architecture:** Keep the current PostgreSQL-centered Hetang system and preserve all current CLI/query surfaces. Add new internal modules under `src/access/`, `src/runtime/`, `src/ops/`, and `src/data-platform/serving/`, then make the existing top-level files act as compatibility facades so the migration stays incremental and low-risk.

**Tech Stack:** TypeScript, Vitest, PostgreSQL, existing Hetang runtime/store/query modules.

---

### Task 1: Define the access-context contracts and failing tests

**Files:**
- Create: `src/access/access-types.ts`
- Create: `src/access/access-context.ts`
- Create: `src/access/access-context.test.ts`
- Modify: `src/access.test.ts`
- Modify: `src/command.ts`

**Step 1: Write the failing tests**

Add `src/access/access-context.test.ts` with cases that prove the new layer returns a machine-readable access envelope instead of only a boolean command decision.

```ts
import { describe, expect, it } from "vitest";
import { buildHetangAccessContext } from "./access-context.js";

describe("buildHetangAccessContext", () => {
  it("returns an allow decision with effective org scope for a single-store manager", () => {
    const context = buildHetangAccessContext({
      action: "report",
      binding: {
        channel: "wecom",
        senderId: "manager-1",
        employeeName: "店长甲",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      usage: {
        hourlyCount: 1,
        dailyCount: 4,
      },
    });

    expect(context.decision.status).toBe("allow");
    expect(context.scope.org_ids).toEqual(["1001"]);
    expect(context.scope.effective_org_id).toBe("1001");
  });
});
```

Extend `src/access.test.ts` with one backward-compatibility case proving `authorizeHetangCommand()` still works by delegating to the new access-context builder.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/access.test.ts src/access/access-context.test.ts
```

Expected: FAIL because `src/access/access-context.ts` and `src/access/access-types.ts` do not exist yet.

**Step 3: Write the minimal contracts**

Add `src/access/access-types.ts` with the smallest stable model:

```ts
export type HetangAccessDecisionStatus = "allow" | "deny";

export type HetangAccessContext = {
  action: string;
  actor: {
    channel: string;
    sender_id: string;
    employee_name?: string;
    role?: string;
  };
  scope: {
    org_ids: string[];
    effective_org_id?: string;
    scope_kind: "single" | "multi" | "all" | "none";
  };
  decision: {
    status: HetangAccessDecisionStatus;
    reason: string;
    consume_quota: boolean;
  };
  quotas: {
    hourly_limit: number;
    daily_limit: number;
    hourly_used: number;
    daily_used: number;
  };
};
```

Implement `src/access/access-context.ts` by moving the current scope/quota/action logic out of `src/access.ts` into `buildHetangAccessContext()`.

**Step 4: Add compatibility wrapper**

Keep `src/access.ts` as the stable import path for old callers, but make:

- `resolveQuotaLimits()` call the new shared logic
- `authorizeHetangCommand()` call `buildHetangAccessContext()` and map it back to the legacy return shape

**Step 5: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/access.test.ts src/access/access-context.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/access.ts src/access.test.ts src/access/access-types.ts src/access/access-context.ts src/access/access-context.test.ts src/command.ts
git commit -m "refactor: introduce access context layer"
```

### Task 2: Make command handling consume access-context instead of raw boolean auth

**Files:**
- Modify: `src/command.ts`
- Modify: `src/command.test.ts`
- Modify: `src/access.ts`
- Modify: `src/access/access-context.ts`

**Step 1: Write the failing command tests**

Add command tests proving:

- denied responses still render the same Chinese user-facing text
- `recordCommandAudit()` receives the access-context reason/effective org
- `whoami` can show resolved scope from the new access context

Use a focused test like:

```ts
expect(auditRecord.reason).toBe("manager-multi-store-requires-org");
expect(auditRecord.effectiveOrgId).toBeUndefined();
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/command.test.ts
```

Expected: FAIL because `command.ts` still branches directly on the legacy access object.

**Step 3: Implement the command migration**

In `src/command.ts`:

- import `buildHetangAccessContext()` from `src/access/access-context.ts`
- replace the single `authorizeHetangCommand()` call in the main command path with `buildHetangAccessContext()`
- keep the old `authorizeHetangCommand()` export only for compatibility and existing tests
- derive `access.allowed` as `context.decision.status === "allow"`

Minimal usage shape:

```ts
const accessContext = buildHetangAccessContext({
  action,
  binding,
  usage,
  requestedOrgId,
  quotaOverrides,
});

if (accessContext.decision.status !== "allow") {
  const text = messageForDeniedReason(accessContext.decision.reason);
  // write audit record using accessContext.scope.effective_org_id
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/command.test.ts src/access.test.ts src/access/access-context.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/command.ts src/command.test.ts src/access.ts src/access/access-context.ts
git commit -m "refactor: route commands through access context"
```

### Task 3: Introduce a thin runtime shell and move doctor logic into ops

**Files:**
- Create: `src/runtime/runtime-shell.ts`
- Create: `src/runtime/runtime-shell.test.ts`
- Create: `src/ops/doctor.ts`
- Create: `src/ops/doctor.test.ts`
- Modify: `src/runtime.ts`
- Modify: `src/runtime.test.ts`
- Modify: `src/main.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing tests**

Add `src/ops/doctor.test.ts` that asserts doctor text is produced from a dedicated ops module, not from the main runtime class.

```ts
import { describe, expect, it } from "vitest";
import { renderHetangDoctorReport } from "./doctor.js";

describe("renderHetangDoctorReport", () => {
  it("renders DB, scheduler, queue, and store watermark lines", async () => {
    const text = await renderHetangDoctorReport({
      dbUrl: "postgresql://demo@127.0.0.1:5432/hetang_ops",
      poolRole: "query",
      poolMax: 10,
      storeWatermarks: [{ orgId: "1001", storeName: "迎宾店", summary: "1.1=ok" }],
      schedulerLines: ["scheduled-worker: healthy"],
      queueLines: ["Sync queue: idle"],
    });

    expect(text).toContain("DB:");
    expect(text).toContain("迎宾店");
  });
});
```

Add `src/runtime/runtime-shell.test.ts` that proves `HetangRuntimeShell` delegates doctor rendering and serving-query execution to dependencies instead of holding the whole implementation inline.

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/runtime/runtime-shell.test.ts src/ops/doctor.test.ts
```

Expected: FAIL because the new modules do not exist.

**Step 3: Write the minimal shell and ops modules**

Create `src/runtime/runtime-shell.ts` with a smaller class that owns:

- interaction orchestration
- access-context consumption
- query-plane entrypoints
- delivery/sync method delegation

Move the current `doctor()` string-construction logic into `src/ops/doctor.ts`:

```ts
export async function renderHetangDoctorReport(params: {
  dbUrl: string;
  poolRole: string;
  poolMax: number;
  schedulerLines: string[];
  queueLines: string[];
  storeWatermarks: Array<{ orgId: string; storeName: string; summary: string }>;
}): Promise<string> {
  return [
    `DB: ${params.dbUrl}`,
    `DB pool role: ${params.poolRole}`,
    `DB pool max: ${params.poolMax}`,
    ...params.schedulerLines,
    ...params.queueLines,
    ...params.storeWatermarks.map((item) => `${item.storeName} (${item.orgId}) -> ${item.summary}`),
  ].join("\\n");
}
```

**Step 4: Convert `src/runtime.ts` into a compatibility facade**

Keep `HetangOpsRuntime` as the external class name for now, but:

- instantiate or extend `HetangRuntimeShell`
- forward `doctor()` to `renderHetangDoctorReport()`
- keep existing public methods stable so current callers do not break

Update `src/main.ts` and `src/cli.ts` only if imports need to point to the new shell implementation.

**Step 5: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/runtime.test.ts src/runtime/runtime-shell.test.ts src/ops/doctor.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/runtime.ts src/runtime.test.ts src/runtime/runtime-shell.ts src/runtime/runtime-shell.test.ts src/ops/doctor.ts src/ops/doctor.test.ts src/main.ts src/cli.ts
git commit -m "refactor: introduce runtime shell and ops doctor module"
```

### Task 4: Extract the serving-query boundary from runtime/store into data-platform serving modules

**Files:**
- Create: `src/data-platform/serving/serving-query-store.ts`
- Create: `src/data-platform/serving/serving-query-store.test.ts`
- Create: `src/data-platform/serving/serving-manifest.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`
- Modify: `src/runtime.ts`
- Modify: `src/query-engine.ts`
- Modify: `src/query-engine.test.ts`

**Step 1: Write the failing tests**

Add a serving-query-store test that verifies the serving module, not the runtime, owns:

- `getCurrentServingVersion()`
- `executeCompiledServingQuery()`

```ts
import { describe, expect, it, vi } from "vitest";
import { createServingQueryStore } from "./serving-query-store.js";

describe("createServingQueryStore", () => {
  it("reads the latest serving version and executes compiled SQL through pg", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ serving_version: "serving-v2" }] })
      .mockResolvedValueOnce({ rows: [{ org_id: "1001" }] });

    const store = createServingQueryStore({ query });

    await expect(store.getCurrentServingVersion()).resolves.toBe("serving-v2");
    await expect(store.executeCompiledServingQuery("select 1", [])).resolves.toEqual([{ org_id: "1001" }]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/store.test.ts src/query-engine.test.ts src/data-platform/serving/serving-query-store.test.ts
```

Expected: FAIL because the new serving module does not exist and current code still reads through `runtime.ts`.

**Step 3: Implement the serving module extraction**

Create:

- `src/data-platform/serving/serving-manifest.ts`
- `src/data-platform/serving/serving-query-store.ts`

Move the current SQL from `src/store.ts` methods into these modules, then let `src/store.ts` compose them instead of owning the SQL inline.

Minimal interface:

```ts
export type ServingQueryStore = {
  getCurrentServingVersion(): Promise<string | null>;
  executeCompiledServingQuery(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};
```

Then update:

- `src/runtime.ts` to delegate serving reads to the serving-query-store dependency
- `src/query-engine.ts` to keep using `runtime.getCurrentServingVersion()` and `runtime.executeCompiledServingQuery()` until a later phase

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/store.test.ts src/runtime.test.ts src/query-engine.test.ts src/data-platform/serving/serving-query-store.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts src/runtime.ts src/query-engine.ts src/query-engine.test.ts src/data-platform/serving/serving-manifest.ts src/data-platform/serving/serving-query-store.ts src/data-platform/serving/serving-query-store.test.ts
git commit -m "refactor: extract serving query store boundary"
```

### Task 5: Verify the phase-1 kernelization slice and document compatibility rules

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-04-10-hetang-navly-aligned-target-architecture-design.md`
- Modify: `docs/plans/2026-04-10-hetang-kernelization-phase1-implementation-plan.md`

**Step 1: Run the focused test suite**

Run:

```bash
pnpm exec vitest run \
  src/access.test.ts \
  src/access/access-context.test.ts \
  src/command.test.ts \
  src/runtime.test.ts \
  src/runtime/runtime-shell.test.ts \
  src/ops/doctor.test.ts \
  src/store.test.ts \
  src/query-engine.test.ts \
  src/data-platform/serving/serving-query-store.test.ts
```

Expected: PASS

**Step 2: Run the full TypeScript suite**

Run:

```bash
pnpm exec vitest run
```

Expected: PASS

**Step 3: Update the docs**

In `README.md`, add a short architecture note stating:

- `src/access/` owns machine-readable access context
- `src/runtime/` owns the thin runtime shell
- `src/data-platform/serving/` owns serving-version and compiled-query read surfaces
- `src/access.ts`, `src/runtime.ts`, and `src/store.ts` remain compatibility facades during migration

**Step 4: Commit**

```bash
git add README.md docs/plans/2026-04-10-hetang-navly-aligned-target-architecture-design.md docs/plans/2026-04-10-hetang-kernelization-phase1-implementation-plan.md
git commit -m "docs: record phase1 kernelization compatibility rules"
```

---

## Scope Guardrails

This phase intentionally does **not** do the following:

- move query-plane files into a new physical directory
- split `store.ts` into full truth/derived/serving owner modules
- redesign sync orchestration
- introduce a full Navly-style auth kernel
- change any SQL semantics or serving table schemas

The only purpose of phase 1 is to establish the first real architectural seams without breaking the current Hetang product.
