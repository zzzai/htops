# Hetang Operating Recommendation System v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 `htops` 架构上落地荷塘经营推荐系统 v1，让系统能统一生成、排序和解释客户运营、门店经营与总部管理的候选动作，并形成反馈学习闭环。

**Architecture:** 保持现有 `fact -> mart -> serving -> rendering` 主链和 customer-growth owner path 不变。先以客户运营动作推荐为第一阶段，把 `候选生成 -> 主排序 -> LLM 增强/重排 -> 解释 -> 反馈学习` 建成，再逐步扩到门店经营动作和总部资源动作。主排序坚持 deterministic constraints + small-model scoring，LLM 只做增强、控制和解释。

**Tech Stack:** TypeScript, PostgreSQL, Vitest, current customer-growth modules, current world-model modules, current store/external-context layers, bounded LLM synthesis

---

### Task 1: 定义经营动作推荐的统一类型

**Files:**
- Modify: `src/types.ts`
- Add: `src/operating-recommendation/types.ts`
- Add: `src/operating-recommendation/types.test.ts`

**Step 1: Write the failing test**

- 在 `src/operating-recommendation/types.test.ts` 增加测试
- 断言存在统一推荐类型：
  - `customer_operation`
  - `store_operation`
  - `hq_resource`
- 断言存在统一候选结构：
  - `actionId`
  - `actionKind`
  - `targetScope`
  - `candidateReason`
  - `baseScore`
  - `constraintFlags`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/operating-recommendation/types.test.ts`

Expected:

- FAIL，因为当前还没有统一经营推荐类型层

**Step 3: Write minimal implementation**

- 在 `src/operating-recommendation/types.ts` 中定义候选动作、主排序输入、LLM 重排输入、反馈记录类型
- 在 `src/types.ts` 中桥接必要导出

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/operating-recommendation/types.test.ts`

Expected:

- PASS，经营推荐系统有统一数据结构

**Step 5: Commit**

```bash
git add src/types.ts src/operating-recommendation/types.ts src/operating-recommendation/types.test.ts
git commit -m "feat: add operating recommendation core types"
```

### Task 2: 增加经营动作候选表与 owner store 接口

**Files:**
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 在 `src/store.test.ts` 中增加经营动作候选测试
- 断言 `store.initialize()` 会创建：
  - `mart_operating_action_candidates_daily`
  - `mart_operating_action_rankings_daily`
  - `mart_operating_action_outcomes_daily`
- 断言可读写：
  - 候选动作
  - 排序结果
  - 执行反馈

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists operating action candidates rankings and outcomes"`

Expected:

- FAIL，因为当前还没有统一经营动作推荐存储层

**Step 3: Write minimal implementation**

- 在 `src/store.ts` 中新增 3 张表及索引
- 新增 owner store 方法：
  - `replaceOperatingActionCandidates()`
  - `replaceOperatingActionRankings()`
  - `upsertOperatingActionOutcome()`
  - `listOperatingActionRankings()`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists operating action candidates rankings and outcomes"`

Expected:

- PASS，推荐系统有正式存储底座

**Step 5: Commit**

```bash
git add src/store.ts src/types.ts src/store.test.ts
git commit -m "feat: add operating action recommendation storage"
```

### Task 3: 构建客户运营动作候选生成器

**Files:**
- Add: `src/operating-recommendation/candidates.ts`
- Add: `src/operating-recommendation/candidates.test.ts`
- Modify: `src/customer-growth/query.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`

**Step 1: Write the failing test**

- 为候选生成器增加测试
- 给一组队列、特征、策略 fixture
- 断言能生成客户运营候选动作：
  - `immediate-1to1`
  - `scheduled-reactivation`
  - `growth-nurture`
  - `observe`
- 断言每个候选都有明确 target、daypart、reason

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/operating-recommendation/candidates.test.ts`

Expected:

- FAIL，因为当前召回队列不是统一经营候选层

**Step 3: Write minimal implementation**

- 在 `src/operating-recommendation/candidates.ts` 中复用现有 reactivation queue / strategy / demand clock
- 先只生成客户运营候选动作
- 不扩展到门店/HQ，保持 v1 最小范围

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/operating-recommendation/candidates.test.ts`

Expected:

- PASS，客户运营动作 candidate 层建立

**Step 5: Commit**

```bash
git add src/operating-recommendation/candidates.ts src/operating-recommendation/candidates.test.ts src/customer-growth/query.ts src/customer-growth/reactivation/queue.ts
git commit -m "feat: build customer operation action candidates"
```

### Task 4: 构建主排序器

**Files:**
- Add: `src/operating-recommendation/scoring.ts`
- Add: `src/operating-recommendation/scoring.test.ts`
- Modify: `src/business-score.ts`

**Step 1: Write the failing test**

- 为主排序器增加测试
- 断言主排序会综合：
  - customer value
  - arrival probability proxy
  - demand strength
  - intake feasibility
  - margin priority
  - risk constraints
- 断言供给不足的动作即使 demand 强也会被压制

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/operating-recommendation/scoring.test.ts`

Expected:

- FAIL，因为当前还没有经营动作统一主排序器

**Step 3: Write minimal implementation**

- 在 `src/operating-recommendation/scoring.ts` 中实现 deterministic + small-score 组合
- 先不引入真正机器学习训练框架，v1 用稳定打分式架构
- 可复用 `business-score` 中已有评分思想

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/operating-recommendation/scoring.test.ts`

Expected:

- PASS，主排序建立

**Step 5: Commit**

```bash
git add src/operating-recommendation/scoring.ts src/operating-recommendation/scoring.test.ts src/business-score.ts
git commit -m "feat: add operating action primary scorer"
```

### Task 5: 加入 LLM 特征增强输入层

**Files:**
- Add: `src/operating-recommendation/feature-enrichment.ts`
- Add: `src/operating-recommendation/feature-enrichment.test.ts`
- Modify: `src/store-external-context.ts`
- Modify: `src/world-model/state.ts`

**Step 1: Write the failing test**

- 增加测试，验证 feature enrichment 能读取：
  - store master side info
  - external observations
  - review themes / research notes
  - world model demand/intake summaries
- 断言输出是结构化增强字段，而不是自由文本

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/operating-recommendation/feature-enrichment.test.ts`

Expected:

- FAIL，因为当前还没有经营推荐专用增强层

**Step 3: Write minimal implementation**

- 在 `src/operating-recommendation/feature-enrichment.ts` 中定义 LLM-safe enrichment input builder
- 明确只输出：
  - side info tags
  - caution flags
  - environment notes
  - not-for-scoring narrative

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/operating-recommendation/feature-enrichment.test.ts`

Expected:

- PASS，LLM 特征增强层具备标准输入

**Step 5: Commit**

```bash
git add src/operating-recommendation/feature-enrichment.ts src/operating-recommendation/feature-enrichment.test.ts src/store-external-context.ts src/world-model/state.ts
git commit -m "feat: add operating recommendation feature enrichment input"
```

### Task 6: 加入 top-K LLM 重排层

**Files:**
- Add: `src/operating-recommendation/rerank.ts`
- Add: `src/operating-recommendation/rerank.test.ts`
- Modify: `src/app/analysis-bounded-synthesis.ts`

**Step 1: Write the failing test**

- 增加测试，验证 rerank 只处理 top-K 候选
- 断言：
  - LLM 不能改变硬约束禁用动作
  - LLM 可以在分数接近时调整相对顺序
  - LLM 输出必须带原因和风险

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/operating-recommendation/rerank.test.ts`

Expected:

- FAIL，因为当前还没有经营推荐 rerank owner module

**Step 3: Write minimal implementation**

- 在 `src/operating-recommendation/rerank.ts` 中实现 bounded rerank contract
- 先做接口和 deterministic fallback，不要求直接接在线大模型
- 在 `analysis-bounded-synthesis` 中复用安全边界约束

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/operating-recommendation/rerank.test.ts`

Expected:

- PASS，top-K rerank 具备安全边界

**Step 5: Commit**

```bash
git add src/operating-recommendation/rerank.ts src/operating-recommendation/rerank.test.ts src/app/analysis-bounded-synthesis.ts
git commit -m "feat: add bounded operating recommendation rerank"
```

### Task 7: 加入推荐解释层

**Files:**
- Add: `src/operating-recommendation/render.ts`
- Add: `src/operating-recommendation/render.test.ts`
- Modify: `src/query-engine-renderer.ts`
- Modify: `src/report.ts`
- Modify: `src/weekly-report.ts`

**Step 1: Write the failing test**

- 增加测试，验证推荐结果可渲染成：
  - 客服执行话术
  - 店长动作建议
  - 总部优先级摘要
- 断言输出是经营语言，不暴露模型内部术语

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/operating-recommendation/render.test.ts src/query-engine-renderer.test.ts src/report.test.ts src/weekly-report.test.ts`

Expected:

- FAIL，因为当前推荐解释还是散落在不同模块

**Step 3: Write minimal implementation**

- 在 `src/operating-recommendation/render.ts` 中实现统一渲染器
- 把推荐说明接入 query / 日报 / 周报
- 保持对店长端和总部端的叙述不同粒度

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/operating-recommendation/render.test.ts src/query-engine-renderer.test.ts src/report.test.ts src/weekly-report.test.ts`

Expected:

- PASS，推荐系统进入输出面

**Step 5: Commit**

```bash
git add src/operating-recommendation/render.ts src/operating-recommendation/render.test.ts src/query-engine-renderer.ts src/report.ts src/weekly-report.ts
git commit -m "feat: render operating recommendations in business outputs"
```

### Task 8: 加入反馈学习闭环

**Files:**
- Add: `src/operating-recommendation/learning.ts`
- Add: `src/operating-recommendation/learning.test.ts`
- Modify: `src/app/reactivation-execution-service.ts`
- Modify: `src/world-model/state.ts`

**Step 1: Write the failing test**

- 增加测试，验证学习层可根据 outcome 计算：
  - action success score
  - interference / misfire flags
  - repeatability hints
- 断言结果可回灌到下一轮推荐 summary

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/operating-recommendation/learning.test.ts`

Expected:

- FAIL，因为当前 outcome 虽有，但还没有 operating recommendation learning owner module

**Step 3: Write minimal implementation**

- 在 `src/operating-recommendation/learning.ts` 中把联系/预约/到店/储值等反馈转成 learning summary
- 在 `reactivation-execution-service` 中接入 outcome feed
- 在 `world-model/state.ts` 中可读出最近动作反馈摘要

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/operating-recommendation/learning.test.ts`

Expected:

- PASS，反馈学习形成闭环

**Step 5: Commit**

```bash
git add src/operating-recommendation/learning.ts src/operating-recommendation/learning.test.ts src/app/reactivation-execution-service.ts src/world-model/state.ts
git commit -m "feat: add operating recommendation learning loop"
```

### Task 9: 接入世界模型的动作推荐出口

**Files:**
- Modify: `src/world-model/mechanisms.ts`
- Modify: `src/world-model/simulator.ts`
- Modify: `src/world-model/rendering.ts`
- Test: `src/world-model/mechanisms.test.ts`
- Test: `src/world-model/simulator.test.ts`
- Test: `src/world-model/rendering.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 world model 可把 recommendation 输出为：
  - action preview
  - constrained next best action
  - why-not explanation
- 断言 world model 读 recommendation，不直接取代 recommendation 主排序

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/mechanisms.test.ts src/world-model/simulator.test.ts src/world-model/rendering.test.ts`

Expected:

- FAIL，因为当前 world model 还没有 operating recommendation 出口

**Step 3: Write minimal implementation**

- 在 world model 的 mechanism / simulator / rendering 中加入 recommendation consumption
- 只把推荐作为决策出口，不把 world model 改成主排序器

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/mechanisms.test.ts src/world-model/simulator.test.ts src/world-model/rendering.test.ts`

Expected:

- PASS，世界模型和经营推荐系统正式联动

**Step 5: Commit**

```bash
git add src/world-model/mechanisms.ts src/world-model/simulator.ts src/world-model/rendering.ts src/world-model/mechanisms.test.ts src/world-model/simulator.test.ts src/world-model/rendering.test.ts
git commit -m "feat: expose operating recommendations through world model"
```

### Task 10: 端到端验证

**Files:**
- Verify only

**Step 1: Run focused recommendation tests**

Run:

```bash
pnpm exec vitest run src/operating-recommendation/types.test.ts src/operating-recommendation/candidates.test.ts src/operating-recommendation/scoring.test.ts src/operating-recommendation/feature-enrichment.test.ts src/operating-recommendation/rerank.test.ts src/operating-recommendation/render.test.ts src/operating-recommendation/learning.test.ts
```

Expected:

- PASS，经营推荐系统核心模块通过

**Step 2: Run impacted business surface tests**

Run:

```bash
pnpm exec vitest run src/store.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/query-engine-renderer.test.ts src/report.test.ts src/weekly-report.test.ts src/world-model/state.test.ts src/world-model/mechanisms.test.ts src/world-model/simulator.test.ts src/world-model/rendering.test.ts
```

Expected:

- PASS，现有业务读链和动作链兼容

**Step 3: Run TypeScript check**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`

Expected:

- 若失败，明确区分本次新增错误与仓库既有错误

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add hetang operating recommendation system v1"
```

---

Plan complete and saved to `docs/plans/2026-04-21-hetang-operating-recommendation-system-v1-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
