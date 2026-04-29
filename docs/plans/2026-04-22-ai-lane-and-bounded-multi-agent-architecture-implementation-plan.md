# AI Lane And Bounded Multi-Agent Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `htops` 建立统一 AI lane 骨架，完成第一批 6 条 lane 的配置与接线，优先把 `analysis-premium` 升级为强推理 lane，并为后续 HQ / doctor / world-model explanation 的 bounded multi-agent 演进留出清晰接口。

**Architecture:** 保持当前 `Capability Graph -> Query Plan -> Safe Execution` 主链不变，不把 `src/runtime.ts` 变成 AI 总控。先新增 `src/ai-lanes/` owner module 和 `htops.json` 顶层 `aiLanes` 配置，再让各 owner module 读取 lane contract；第一波先接 `general-lite / semantic-fallback / customer-growth-json / cheap-summary / analysis-premium / offline-review`，并只把 `analysis-premium` 切到 `gpt-5.4`。

**Tech Stack:** TypeScript, Python, PostgreSQL, Vitest, existing Hermes gateway override, current analysis sidecar, current customer-growth AI client, repo-local `htops.json` config parsing

---

### Task 1: 在类型层和配置层引入统一 `aiLanes`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `htops.json.example`

**Step 1: Write the failing tests**

- 在 `src/config.test.ts` 增加测试，验证：
  - `aiLanes` 顶层配置可被解析
  - 未配置 `aiLanes` 时，legacy `semanticFallback` / `customerGrowthAi` 仍能正常工作
  - lane 可定义 `model / reasoningMode / timeoutMs / responseMode / fallbackBehavior`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/config.test.ts`

Expected:

- FAIL，因为当前配置层还没有 `aiLanes`

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 新增：
  - `HetangAiLaneId`
  - `HetangAiLaneConfig`
  - `HetangAiLaneRegistryConfig`
- 在 `src/config.ts` 新增 `aiLanes` 解析
- 继续保留 legacy 配置解析
- 在 `htops.json.example` 增加第一批 6 条 lane 示例

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/config.test.ts`

Expected:

- PASS，且 legacy 配置兼容仍在

**Step 5: Commit**

```bash
git add src/types.ts src/config.ts src/config.test.ts htops.json.example
git commit -m "feat: add unified ai lane config"
```

### Task 2: 新增 `src/ai-lanes/` owner module

**Files:**
- Add: `src/ai-lanes/types.ts`
- Add: `src/ai-lanes/registry.ts`
- Add: `src/ai-lanes/resolver.ts`
- Add: `src/ai-lanes/observability.ts`
- Add: `src/ai-lanes/registry.test.ts`
- Add: `src/ai-lanes/resolver.test.ts`

**Step 1: Write the failing tests**

- 新增测试，验证：
  - 第一批 6 条 lane 都有默认 registry entry
  - `resolveAiLaneConfig(config, laneId)` 能合并默认值和 `htops.json` 覆盖
  - lane fallback contract 可被解析

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/ai-lanes/registry.test.ts src/ai-lanes/resolver.test.ts`

Expected:

- FAIL，因为 `src/ai-lanes/` 尚不存在

**Step 3: Write minimal implementation**

- 在 `src/ai-lanes/registry.ts` 固化第一批 6 条 lane 的默认 contract
- 在 `src/ai-lanes/resolver.ts` 提供：
  - `resolveAiLaneConfig(config, laneId)`
  - `resolveAiLaneModel(config, laneId)`
  - `resolveAiLaneFallback(config, laneId)`
- 在 `src/ai-lanes/observability.ts` 提供 lane 可视化摘要辅助函数

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/ai-lanes/registry.test.ts src/ai-lanes/resolver.test.ts`

Expected:

- PASS，lane registry 可用

**Step 5: Commit**

```bash
git add src/ai-lanes
git commit -m "feat: add ai lane registry owner module"
```

### Task 3: 先接 TypeScript 侧的 4 条 lane

**Files:**
- Modify: `src/ai-semantic-fallback.ts`
- Modify: `src/customer-growth/ai/client.ts`
- Modify: `src/app/xiaohongshu-link-service.ts`
- Modify: `src/external-intelligence/llm.ts`
- Modify: `src/ai-semantic-fallback.test.ts`
- Modify: `src/customer-growth/ai/client.test.ts`
- Modify: `src/app/xiaohongshu-link-service.test.ts`
- Modify: `src/external-intelligence/llm.test.ts`

**Step 1: Write the failing tests**

- 调整测试，验证：
  - `semantic-fallback` 从 `aiLanes.semantic-fallback` 读取模型和 timeout
  - `customer-growth-json` 从 `aiLanes.customer-growth-json` 读取模型和 timeout
  - `cheap-summary` 独立于 `customer-growth-json`
  - 未配置 lane 时仍兼容旧行为

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/ai-semantic-fallback.test.ts src/customer-growth/ai/client.test.ts src/app/xiaohongshu-link-service.test.ts src/external-intelligence/llm.test.ts`

Expected:

- FAIL，因为这些模块当前直接读各自旧配置

**Step 3: Write minimal implementation**

- `src/ai-semantic-fallback.ts`
  - 改为优先解析 `semantic-fallback` lane
- `src/customer-growth/ai/client.ts`
  - 改为优先解析 `customer-growth-json` lane
- `src/app/xiaohongshu-link-service.ts`
  - 改为读取 `cheap-summary` lane
- `src/external-intelligence/llm.ts`
  - 改为接受 lane-resolved LLM client config

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/ai-semantic-fallback.test.ts src/customer-growth/ai/client.test.ts src/app/xiaohongshu-link-service.test.ts src/external-intelligence/llm.test.ts`

Expected:

- PASS，TypeScript 侧 lane 接线完成

**Step 5: Commit**

```bash
git add src/ai-semantic-fallback.ts src/customer-growth/ai/client.ts src/app/xiaohongshu-link-service.ts src/external-intelligence/llm.ts src/ai-semantic-fallback.test.ts src/customer-growth/ai/client.test.ts src/app/xiaohongshu-link-service.test.ts src/external-intelligence/llm.test.ts
git commit -m "feat: route TypeScript AI callers through ai lanes"
```

### Task 4: 给 Hermes `general-lite` 接统一 lane

**Files:**
- Modify: `hermes_overrides/sitecustomize.py`
- Modify: `hermes_overrides/test_sitecustomize.py`
- Optionally modify: `src/gateway-runtime-policy.ts`
- Optionally modify: `src/gateway-runtime-policy.test.ts`

**Step 1: Write the failing tests**

- 增加测试，验证：
  - `general-lite` 优先读取 `htops.json.aiLanes.general-lite`
  - 若 lane 未配置，则继续使用 Hermes 默认 turn route
  - `reasoning_effort` 可被 lane 显式关闭

**Step 2: Run test to verify it fails**

Run: `/root/.hermes/hermes-agent/venv/bin/pytest hermes_overrides/test_sitecustomize.py -q`

Expected:

- FAIL，因为当前 `general-lite` 只读 Hermes turn route

**Step 3: Write minimal implementation**

- 在 `sitecustomize.py` 中新增读取 `htops.json` lane 配置的辅助函数
- 让 `general-lite` 在 lane 存在时使用 lane 指定模型
- 未配置 lane 时继续回退到现有 Hermes 行为

**Step 4: Run test to verify it passes**

Run: `/root/.hermes/hermes-agent/venv/bin/pytest hermes_overrides/test_sitecustomize.py -q`

Expected:

- PASS，且当前 fast-lane patch 行为不回退

**Step 5: Commit**

```bash
git add hermes_overrides/sitecustomize.py hermes_overrides/test_sitecustomize.py
git commit -m "feat: route general-lite through ai lane config"
```

### Task 5: 把 `analysis-premium` 接到 lane，并切到 `gpt-5.4`

**Files:**
- Modify: `src/app/analysis-service.ts`
- Modify: `src/app/analysis-service.test.ts`
- Modify: `src/app/analysis-local-sidecar.test.ts`
- Possibly modify: `tools/crewai-sidecar/store_review.py`

**Step 1: Write the failing tests**

- 增加测试，验证：
  - `analysis-premium` 从 lane 读取 `model / reasoningMode / timeoutMs`
  - lane 配置优先于 `CREWAI_MODEL` / `OPENAI_MODEL` 默认值
  - lane 若未配置，继续兼容当前 sidecar 环境变量行为

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/analysis-service.test.ts src/app/analysis-local-sidecar.test.ts`

Expected:

- FAIL，因为当前 analysis sidecar 仍主要依赖环境变量和局部设置

**Step 3: Write minimal implementation**

- 在 `src/app/analysis-service.ts` 中：
  - 解析 `analysis-premium` lane
  - 将 lane 的模型、reasoning、timeout 写入 sidecar env
  - 保留 deterministic bounded synthesis fallback
- 默认第一版将 `analysis-premium` 绑定 `gpt-5.4`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/analysis-service.test.ts src/app/analysis-local-sidecar.test.ts`

Expected:

- PASS，并且 fallback 语义不变

**Step 5: Commit**

```bash
git add src/app/analysis-service.ts src/app/analysis-service.test.ts src/app/analysis-local-sidecar.test.ts
git commit -m "feat: route premium analysis through gpt-5.4 lane"
```

### Task 6: 定义 `offline-review` lane，并把 lane 可视性接入 admin/doctor

**Files:**
- Modify: `src/app/admin-read-service.ts`
- Modify: `src/app/admin-read-service.test.ts`
- Modify: `src/ops/doctor.ts`
- Modify: `src/ops/doctor.test.ts`
- Possibly modify: `src/command.ts`
- Possibly modify: `src/command.test.ts`

**Step 1: Write the failing tests**

- 增加测试，验证：
  - admin read 能看到当前 lane -> model -> reasoning 摘要
  - doctor 能显示 premium / cheap / review lane 的当前配置摘要
  - `offline-review` lane 即使尚未接主执行，也能被显式看到

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/admin-read-service.test.ts src/ops/doctor.test.ts src/command.test.ts`

Expected:

- FAIL，因为当前 doctor / admin read 还看不到 AI lane registry

**Step 3: Write minimal implementation**

- 在 admin read 增加 lane observability summary
- 在 doctor 增加当前 lane mapping 摘要
- 显式标出：
  - `general-lite`
  - `semantic-fallback`
  - `customer-growth-json`
  - `cheap-summary`
  - `analysis-premium`
  - `offline-review`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/admin-read-service.test.ts src/ops/doctor.test.ts src/command.test.ts`

Expected:

- PASS，lane 可见

**Step 5: Commit**

```bash
git add src/app/admin-read-service.ts src/app/admin-read-service.test.ts src/ops/doctor.ts src/ops/doctor.test.ts src/command.ts src/command.test.ts
git commit -m "feat: add AI lane observability to admin and doctor"
```

### Task 7: 为 future `hq-premium / world-model-explanation / doctor-review` 预留接口

**Files:**
- Modify: `src/ai-lanes/registry.ts`
- Modify: `src/world-model/` related entry files when execution starts
- Modify: `src/app/external-intelligence-service.ts`
- Modify: `src/app/conversation-review-service.ts`
- Add or update tests as needed

**Step 1: Define the future lane ids in registry**

- 新增但暂不启用：
  - `hq-premium`
  - `world-model-explanation`
  - `doctor-review`

**Step 2: Add no-op or placeholder resolution tests**

Run: `pnpm exec vitest run src/ai-lanes/registry.test.ts`

Expected:

- PASS，future lane id 可见但不影响现有行为

**Step 3: Document activation boundaries**

- 在测试和注释中明确：
  - 这些 future lane 只允许建立在 deterministic evidence / world state 之上
  - 不允许绕过 capability graph 和 safe execution

**Step 4: Commit**

```bash
git add src/ai-lanes/registry.ts src/ai-lanes/registry.test.ts
git commit -m "chore: reserve future premium and review AI lanes"
```

### Task 8: 第二阶段 bounded multi-agent 设计落点

**Files:**
- Create later: `src/analysis-premium/`
- Create later: `src/hq-premium/`
- Create later: `src/doctor-review/`
- Create later: `src/world-model-explanation/`

**Step 1: Do not implement multi-agent yet**

- 第一阶段不落代码
- 只保留 lane 边界和 future owner path

**Step 2: Future activation rule**

- `analysis-premium`
  - 先升级为强推理单 agent
  - 再拆 `signal reviewer / cause synthesizer / action planner / narrative writer`
- `hq-premium`
  - 先有 unified evidence/context read chain
  - 再拆 `store comparator / impact analyst / allocator / executive writer`
- `doctor-review`
  - 先有完整 taxonomy
  - 再拆 `failure clusterer / taxonomy expander / backlog proposer`
- `world-model-explanation`
  - 先有稳定 world state / mechanism
  - 再拆 `mechanism explainer / scenario evaluator / recommendation translator`

**Step 3: Explicit non-goals**

- 不把 query 主链多 agent 化
- 不让 agent 直接写事实层
- 不让 agent 直接替代 safe execution

---

## Rollout Order

严格按下面顺序：

1. `Task 1`
2. `Task 2`
3. `Task 3`
4. `Task 4`
5. `Task 5`
6. `Task 6`
7. `Task 7`
8. `Task 8`

---

## Acceptance Criteria

第一阶段完成后，必须满足：

- 所有新增 AI 使用点先绑定 lane，再绑定模型
- 第一批 6 条 lane 都可以在配置中被显式看到
- `general-lite` 和 `analysis-premium` 已被明确拆成快路和深路
- `analysis-premium` 已经切到 `gpt-5.4`
- `semantic-fallback / customer-growth-json / cheap-summary` 已从局部模型配置切到统一 lane
- doctor / admin read 可以看到当前 lane 摘要
- HQ / doctor / world-model explanation 的 future lane 已留出清晰位置

---

Plan complete and saved to `docs/plans/2026-04-22-ai-lane-and-bounded-multi-agent-architecture-implementation-plan.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
