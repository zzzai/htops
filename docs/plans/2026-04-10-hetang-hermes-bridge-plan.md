# Hetang Hermes Bridge Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local htops bridge service that Hermes can call for `/hetang` command traffic and natural-language inbound traffic without importing htops internals directly.

**Architecture:** Keep the current PostgreSQL-centered runtime and existing worker/query services. Add a new message-entry service that adapts HTTP bridge requests onto `command.ts` and `inbound.ts`, then expose that through a token-protected localhost bridge server and standalone `htops-bridge.service`.

**Tech Stack:** TypeScript, built-in Node HTTP server, Vitest, existing runtime/command/inbound modules, systemd shell wrappers.

---

### Task 1: Define bridge behavior with failing tests

**Files:**
- Create: `src/app/message-entry-service.test.ts`
- Create: `src/bridge/server.test.ts`
- Create: `src/bridge/contracts.ts`

**Step 1: Write the failing tests**

Add tests that prove:

- command requests return an immediate reply payload
- inbound requests can capture the current inbound reply without directly sending through the gateway
- bridge rejects requests without the correct token
- bridge returns `noop` for non-mentioned group inbound traffic

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/app/message-entry-service.test.ts src/bridge/server.test.ts
```

Expected: FAIL because the new bridge modules do not exist yet.

**Step 3: Commit**

```bash
git add src/app/message-entry-service.test.ts src/bridge/server.test.ts src/bridge/contracts.ts
git commit -m "test: define hermes bridge behavior"
```

### Task 2: Implement the message-entry layer

**Files:**
- Create: `src/app/message-entry-service.ts`
- Modify: `src/inbound.ts`
- Modify: `src/command.ts`

**Step 1: Write the minimal implementation**

Implement a dedicated message-entry service that:

- accepts normalized bridge command/inbound requests
- calls `runHetangCommand()` for command traffic
- reuses `createHetangInboundClaimHandler()` with a captured reply sender for inbound traffic
- returns structured reply payloads instead of directly coupling to a gateway adapter

**Step 2: Run tests**

Run:

```bash
pnpm exec vitest run src/app/message-entry-service.test.ts src/inbound.test.ts src/command.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/app/message-entry-service.ts src/inbound.ts src/command.ts
git commit -m "feat: add hermes-ready message entry service"
```

### Task 3: Implement the localhost bridge server

**Files:**
- Create: `src/bridge/server.ts`
- Create: `scripts/run-bridge-service.ts`
- Modify: `package.json`

**Step 1: Write the minimal implementation**

Implement a small HTTP server that:

- binds to configurable host/port
- validates `X-Htops-Bridge-Token`
- exposes `/health`, `/v1/capabilities`, `/v1/messages/command`, `/v1/messages/inbound`
- performs lightweight in-memory dedupe with request/platform message ids

**Step 2: Run tests**

Run:

```bash
pnpm exec vitest run src/bridge/server.test.ts src/app/message-entry-service.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/bridge/server.ts scripts/run-bridge-service.ts package.json
git commit -m "feat: add htops bridge service"
```

### Task 4: Add ops wrappers and docs

**Files:**
- Create: `ops/htops-bridge.sh`
- Create: `ops/systemd/htops-bridge.service`
- Modify: `README.md`

**Step 1: Implement wrappers**

Mirror the existing worker/query API launch style so the bridge can run under systemd with `.env.runtime`.

**Step 2: Update docs**

Document:

- required env vars
- localhost-only contract
- how Hermes should call the bridge

**Step 3: Run focused verification**

Run:

```bash
pnpm exec vitest run src/app/message-entry-service.test.ts src/bridge/server.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add ops/htops-bridge.sh ops/systemd/htops-bridge.service README.md
git commit -m "docs: add hermes bridge operations guide"
```

### Task 5: Regression verification

**Files:**
- Modify: none

**Step 1: Run regression suite**

Run:

```bash
pnpm exec vitest run src/inbound.test.ts src/command.test.ts src/notify.test.ts src/service.test.ts src/runtime.test.ts
```

Expected: PASS

**Step 2: Smoke the bridge runner**

Run:

```bash
node --import tsx scripts/run-bridge-service.ts --help
```

Expected: exits cleanly and prints supported flags.

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: prepare htops for hermes ingress"
```
