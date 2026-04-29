# Hetang Access Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Protect the existing Hetang WeCom command flow with employee bindings, multi-store scopes, per-user quotas, and audit logs.

**Architecture:** Keep the current AI Bot transport untouched. Add a scope table and scope-aware store methods inside `hetang-ops`, then enforce authorization in the `/hetang` command entrypoint. Count quota usage from audit rows so the first rollout stays small and durable while allowing one employee to manage multiple stores.

**Tech Stack:** TypeScript, PostgreSQL via `pg` and `pg-mem`, OpenClaw plugin commands, Vitest

---

### Task 1: Add failing tests for scope-aware bindings and whoami display

**Files:**

- Modify: `extensions/hetang-ops/src/store.test.ts`
- Modify: `extensions/hetang-ops/src/command.test.ts`
- Create: `extensions/hetang-ops/src/access.test.ts`

**Step 1: Write the failing tests**

Cover:

- creating and reading a WeCom employee binding
- persisting multiple store scopes for one employee
- revoking a binding
- counting allowed command usage in hour/day windows
- auditing both allowed and denied requests
- denying unbound users
- allowing a single-scope manager to default to their own store report
- allowing a multi-scope manager to request an allowed store
- denying a multi-scope manager who omits the store on `report`
- denying a manager asking for another store
- returning store names and Chinese employee names from `whoami`
- denying a manager after quota exhaustion
- allowing an unscoped `hq` user to query all stores

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/access.test.ts extensions/hetang-ops/src/store.test.ts extensions/hetang-ops/src/command.test.ts`

Expected: FAIL because the new scope table, scope-aware access logic, and `whoami` display behavior do not exist yet.

**Step 3: Write minimal implementation**

Do not implement behavior beyond the failing expectations.

**Step 4: Run test to verify it passes**

Run the same test command and confirm both files pass.

### Task 2: Add PostgreSQL schema and scope-aware access store methods

**Files:**

- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/store.ts`

**Step 1: Write the failing test**

Extend the Task 1 store tests until they describe the exact row shapes, scope persistence, and quota counting behavior you want.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: FAIL for missing scope table and methods.

**Step 3: Write minimal implementation**

Add:

- access role and binding types
- optional `scopeOrgIds` on employee bindings
- audit record types
- `employee_bindings` and `command_audit_logs` tables
- `employee_binding_scopes` table
- `upsertEmployeeBinding`, `getEmployeeBinding`, `listEmployeeBindings`, `revokeEmployeeBinding`
- scope read/write helpers that preserve backward compatibility with legacy `org_id`
- `recordCommandAudit`, `countAllowedCommandsSince`

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`

Expected: PASS

### Task 3: Enforce scope-aware authorization and `whoami` formatting

**Files:**

- Modify: `extensions/hetang-ops/src/access.ts`
- Modify: `extensions/hetang-ops/src/command.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1: Write the failing test**

Use the new command tests to define:

- default single-scope behavior for managers
- required explicit store selection for multi-scope managers
- hq-only `status` and `sync`
- quota denial after repeated `report`
- open `help` and `whoami`
- `whoami` store-name rendering and `hq` all-store rendering

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/access.test.ts extensions/hetang-ops/src/command.test.ts`

Expected: FAIL because the command path still treats bindings as single-store only.

**Step 3: Write minimal implementation**

Add scope-aware authorization rules:

- `hq` with no scopes may query all stores
- `manager` with one scope may omit the store and default to it
- `manager` with many scopes must specify one allowed store
- `manager` may never leave their allowed scopes
- `whoami` renders Chinese name and store names instead of raw `OrgId`

**Step 4: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/access.test.ts extensions/hetang-ops/src/command.test.ts`

Expected: PASS

### Task 4: Add CLI management for multi-store access bindings

**Files:**

- Modify: `extensions/hetang-ops/src/cli.ts`
- Modify: `extensions/hetang-ops/src/runtime.ts`

**Step 1: Write the failing test**

If a focused CLI test is too expensive, add runtime-level tests for binding grant/list/revoke methods instead.

**Step 2: Run test to verify it fails**

Run the smallest targeted test command for the chosen surface.

**Step 3: Write minimal implementation**

Add:

- `hetang access list`
- `hetang access grant --orgs <orgId,orgId>`
- `hetang access revoke`

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm green.

### Task 5: Update the current verified WeCom binding

**Files:**

- Verify only

**Step 1: Update the verified sender**

Update the existing `wecom:ZhangZhen` binding so it reflects the confirmed user intent:

- Chinese name: `张震`
- role: `hq`
- no store scopes

**Step 2: Send `/hetang whoami` again**

Confirm it now renders headquarters access and the Chinese name.

### Task 6: Final verification

**Files:**

- Verify only

**Step 1: Run targeted suite**

Run: `pnpm test -- extensions/hetang-ops/src/access.test.ts extensions/hetang-ops/src/store.test.ts extensions/hetang-ops/src/command.test.ts extensions/hetang-ops/src/sync-and-report.test.ts`

Expected: PASS

**Step 2: Run build**

Run: `pnpm build`

Expected: PASS

**Step 3: Review residual gaps**

Confirm this rollout only secures `/hetang` commands and does not yet implement general freeform analytics tools.
