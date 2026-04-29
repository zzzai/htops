# Hermes Xiaohongshu Link Sidecar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a production-safe Xiaohongshu link reader lane for Hermes WeCom traffic that immediately acknowledges receipt, reads the link through an AutoCLI sidecar, and sends a deferred summary back to the same conversation.

**Architecture:** Keep Hermes frontdoor detection in `hermes_overrides/sitecustomize.py`, keep bridge/accepted handling in `src/app/message-entry-service.ts`, and add a bounded `XiaohongshuLinkService` owner module in `src/app/`. Use a repo-managed AutoCLI custom adapter under `tools/autocli-adapters/` and optional AI enhancement through the existing `customerGrowthAi.followupSummarizer` credentials when available.

**Tech Stack:** Python frontdoor patching, TypeScript, Vitest, unittest, AutoCLI sidecar, existing bridge deferred notification path.

---

### Task 1: Add frontdoor routing tests for Xiaohongshu links

**Files:**
- Modify: `hermes_overrides/test_sitecustomize.py`

**Step 1: Write the failing test**

Add tests that verify:

- a `xiaohongshu.com` link routes to `_call_inbound_bridge()` even when `route_to_htops=False`
- an `xhslink.com` short link also routes to inbound bridge
- logs contain `lane=xiaohongshu-bridge`

**Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest hermes_overrides.test_sitecustomize.SitecustomizeBridgeFallbackTest.test_routes_xiaohongshu_link_to_inbound_bridge
python -m unittest hermes_overrides.test_sitecustomize.SitecustomizeBridgeFallbackTest.test_logs_frontdoor_lane_for_xiaohongshu_link_bridge
```

Expected: FAIL because the frontdoor does not yet recognize Xiaohongshu links.

**Step 3: Write minimal implementation**

Modify `hermes_overrides/sitecustomize.py` to:

- detect `xiaohongshu.com` and `xhslink.com`
- route those messages to `_call_inbound_bridge()`
- log `lane=xiaohongshu-bridge reason=xiaohongshu-link`

**Step 4: Run test to verify it passes**

Run the same commands again and confirm PASS.

**Step 5: Commit**

```bash
git add hermes_overrides/sitecustomize.py hermes_overrides/test_sitecustomize.py
git commit -m "feat: route xiaohongshu links through inbound bridge"
```

### Task 2: Add config coverage for Xiaohongshu inbound link reader

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `htops.json.example`

**Step 1: Write the failing test**

Add config tests that verify:

- `inboundLinkReaders.xiaohongshu` defaults are present and disabled
- explicit config values are parsed

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/config.test.ts
```

Expected: FAIL because the config block does not exist.

**Step 3: Write minimal implementation**

Add bounded types and config parsing for:

- `enabled`
- `autocliBin`
- `timeoutMs`
- `browserTimeoutMs`
- `acceptText`
- `maxContentChars`

Also document the block in `htops.json.example`.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/types.ts src/config.ts src/config.test.ts htops.json.example
git commit -m "feat: add xiaohongshu inbound link reader config"
```

### Task 3: Add XiaohongshuLinkService with deterministic summary fallback

**Files:**
- Create: `src/app/xiaohongshu-link-service.ts`
- Create: `src/app/xiaohongshu-link-service.test.ts`
- Create: `tools/autocli-adapters/xiaohongshu/read-note.yaml`

**Step 1: Write the failing test**

Add tests covering:

- extracting the first Xiaohongshu URL from free text
- building AutoCLI argv for `xiaohongshu read-note <url> --format json`
- parsing JSON stdout
- returning a deterministic summary when AI is unavailable
- returning safe user-facing failure messages when AutoCLI is missing or sidecar output is invalid

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/app/xiaohongshu-link-service.test.ts
```

Expected: FAIL because the service does not exist.

**Step 3: Write minimal implementation**

Implement `XiaohongshuLinkService` that:

- checks whether a message contains a supported link
- invokes AutoCLI via `runCommandWithTimeout`
- parses adapter output JSON
- uses deterministic summarization first
- optionally calls the existing `customerGrowthAi.followupSummarizer` lane for a shorter summary when configured

Also add a repo-owned AutoCLI custom adapter at:

- `tools/autocli-adapters/xiaohongshu/read-note.yaml`

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/app/xiaohongshu-link-service.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/xiaohongshu-link-service.ts src/app/xiaohongshu-link-service.test.ts tools/autocli-adapters/xiaohongshu/read-note.yaml
git commit -m "feat: add xiaohongshu link sidecar service"
```

### Task 4: Wire the service into message-entry accepted/deferred flow

**Files:**
- Modify: `src/app/message-entry-service.ts`
- Modify: `src/app/message-entry-service.test.ts`
- Modify: `scripts/run-bridge-service.ts`

**Step 1: Write the failing test**

Add tests that verify:

- Xiaohongshu link inbound requests return `accepted` after 2 seconds with text `收到，正在读取。`
- once sidecar work completes, deferred delivery sends the final summary to the same conversation
- non-Xiaohongshu inbound traffic keeps the existing accept text and behavior

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/app/message-entry-service.test.ts
```

Expected: FAIL because the service is not yet wired and accept text is not specialized.

**Step 3: Write minimal implementation**

Modify `createHetangMessageEntryService()` to:

- accept an optional `xiaohongshuLinkService`
- detect and short-circuit Xiaohongshu link inbound requests after inbound audit is recorded
- use per-request accepted text override for Xiaohongshu

Modify `scripts/run-bridge-service.ts` to instantiate and inject `XiaohongshuLinkService`.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/app/message-entry-service.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/message-entry-service.ts src/app/message-entry-service.test.ts scripts/run-bridge-service.ts
git commit -m "feat: wire xiaohongshu sidecar into bridge accepted flow"
```

### Task 5: Add adapter install helper / runbook surface

**Files:**
- Create: `scripts/install-autocli-xiaohongshu-adapter.ts`
- Create: `src/install-autocli-xiaohongshu-adapter-script.ts`
- Create: `src/install-autocli-xiaohongshu-adapter-script.test.ts`

**Step 1: Write the failing test**

Add script tests covering:

- copying repo adapter YAML to `~/.autocli/adapters/xiaohongshu/read-note.yaml`
- creating parent directories when missing

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/install-autocli-xiaohongshu-adapter-script.test.ts
```

Expected: FAIL because the helper does not exist.

**Step 3: Write minimal implementation**

Create a small install helper that:

- resolves repo adapter path
- resolves target `~/.autocli/adapters/xiaohongshu/`
- copies the YAML file
- prints next steps for binary install, extension load, and `autocli doctor`

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/install-autocli-xiaohongshu-adapter-script.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/install-autocli-xiaohongshu-adapter.ts src/install-autocli-xiaohongshu-adapter-script.ts src/install-autocli-xiaohongshu-adapter-script.test.ts
git commit -m "feat: add autocli xiaohongshu adapter installer"
```

### Task 6: Verify the full bounded chain

**Files:**
- No code changes required unless verification uncovers a defect

**Step 1: Run targeted tests**

Run:

```bash
python -m unittest hermes_overrides.test_sitecustomize
npm test -- src/config.test.ts src/app/xiaohongshu-link-service.test.ts src/app/message-entry-service.test.ts
```

Expected: PASS.

**Step 2: Run infra doctor because bridge surface changed**

Run:

```bash
npm run codex:doctor
```

Expected: PASS or actionable warnings only.

**Step 3: Optional local sidecar verification**

Run after installing AutoCLI and loading the extension:

```bash
autocli doctor
node --import tsx scripts/install-autocli-xiaohongshu-adapter.ts
autocli xiaohongshu read-note "https://www.xiaohongshu.com/explore/<note-or-share-url>" --format json
```

Expected: adapter returns structured JSON.

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add hermes xiaohongshu link sidecar flow"
```

Plan complete and saved to `docs/plans/2026-04-19-hermes-xiaohongshu-link-sidecar-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
