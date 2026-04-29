# Operating World Model v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 `htops` 架构上落地 `Operating World Model v1` 的初版骨架，让系统具备统一世界状态、机制表达、bounded 场景推演和学习回灌能力。

**Architecture:** 保持 `事实层 -> owner modules -> serving/read surfaces -> safe execution` 现有主链不变，在其上新增 `world state / mechanism / simulation / decision / learning` 五层能力。所有新能力必须严格服从硬事实、软事实、弱信号边界，不引入第二套 runtime，不让 AI 成为事实源。

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, current customer-growth / external-context / reporting / query modules, checked-in JSON assets, bounded AI synthesis

---

### Task 1: 在类型层显式引入 world state 结构

**Files:**
- Modify: `src/types.ts`
- Add: `src/world-model/types.ts`
- Add: `src/world-model/types.test.ts`

**Step 1: Write the failing test**

- 为 world state 类型增加测试，验证存在：
  - `customerState`
  - `storeState`
  - `marketState`
  - `industryState`
  - `worldStateSnapshot`
- 验证每个 state 都能标注：
  - source category
  - truth boundary
  - update timestamp

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/types.test.ts`

Expected:

- FAIL，因为当前仓库还没有 world model 类型层

**Step 3: Write minimal implementation**

- 新增 `src/world-model/types.ts`
- 在 `src/types.ts` 中复用或桥接必要类型
- 明确 world state 不是替代现有业务类型，而是聚合视图

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/types.test.ts`

Expected:

- PASS，world state 骨架建立

### Task 2: 组装统一世界状态快照

**Files:**
- Add: `src/world-model/state.ts`
- Add: `src/world-model/state.test.ts`
- Modify: `src/store-external-context.ts`
- Modify: `src/customer-growth/environment-context.ts`
- Modify: `src/customer-growth/intelligence.ts`

**Step 1: Write the failing test**

- 为 `buildOperatingWorldStateSnapshot()` 增加测试
- 验证它能把：
  - customer intelligence
  - store external context
  - environment context
  - feedback learning snapshot
  组装成统一 world state

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/state.test.ts`

Expected:

- FAIL，因为当前还没有统一状态装配器

**Step 3: Write minimal implementation**

- 新增 state assembler
- 首版只做只读组装，不做复杂推理
- 明确把：
  - 硬事实写入 state core
  - 软事实写入 bounded state context
  - 弱信号写入 narrative-only state context

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/state.test.ts`

Expected:

- PASS，并且 world state 可以稳定组装

### Task 3: 新增经营机制库的最小表达

**Files:**
- Add: `src/world-model/mechanisms.ts`
- Add: `src/world-model/mechanisms.test.ts`

**Step 1: Write the failing test**

- 为机制库增加测试，验证系统可以表达最小机制：
  - 晚场机会机制
  - 供给承接约束机制
  - 高价值沉默客召回机制
  - 竞对压力机制
  - 客流与储值分化机制

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/mechanisms.test.ts`

Expected:

- FAIL，因为当前系统还没有统一“经营机制层”

**Step 3: Write minimal implementation**

- 用确定性机制定义表达：
  - trigger conditions
  - evidence fields
  - likely implications
  - suggested actions
- 暂不做复杂因果图，只做机制库字典

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/mechanisms.test.ts`

Expected:

- PASS，并形成 v1 机制库

### Task 4: 新增 bounded 场景推演器

**Files:**
- Add: `src/world-model/simulator.ts`
- Add: `src/world-model/simulator.test.ts`
- Modify: `src/world-model/state.ts`
- Modify: `src/world-model/mechanisms.ts`

**Step 1: Write the failing test**

- 为 simulator 增加测试，验证支持：
  - `explain_current_state`
  - `counterfactual`
  - `action_preview`
- 验证输出包含：
  - likely upside
  - likely risk
  - required conditions
  - confidence band

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/simulator.test.ts`

Expected:

- FAIL，因为当前还没有场景推演器

**Step 3: Write minimal implementation**

- 不做复杂预测模型
- 先以：
  - 世界状态
  - 机制匹配结果
  - bounded heuristic adjustments
  生成推演结果

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/simulator.test.ts`

Expected:

- PASS，形成 v1 bounded simulator

### Task 5: 打通到总部诊断与门店建议读链路

**Files:**
- Modify: `src/query-engine-renderer.ts`
- Modify: `src/weekly-report.ts`
- Modify: `src/store-query.ts`
- Add: `src/world-model/rendering.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证总部周报和门店建议可读取 simulator 输出
- 验证：
  - HQ narrative 可以引用 market/industry simulation
  - 店长建议只吸收 bounded action preview

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/rendering.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts`

Expected:

- FAIL，因为 world model 结果还未接入现有输出层

**Step 3: Write minimal implementation**

- 给 HQ narrative 增加世界状态和场景推演摘要入口
- 给门店 advice 增加 bounded action preview
- 保持日报谨慎，不被弱信号主导

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/rendering.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts`

Expected:

- PASS，world model 读链打通

### Task 6: 打通到 customer growth 动作层

**Files:**
- Modify: `src/customer-growth/reactivation/strategy.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`
- Modify: `src/customer-growth/reactivation/learning.ts`
- Add: `src/world-model/customer-growth-bridge.ts`
- Add: `src/world-model/customer-growth-bridge.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 world model 输出能影响：
  - recommended action preview
  - bounded queue prioritization adjustment
  - execution learning context
- 验证不会直接改 primary segment

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/customer-growth-bridge.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts`

Expected:

- FAIL，因为 world model 还没有桥接进 customer growth 动作层

**Step 3: Write minimal implementation**

- 新增 bridge 层，把 simulator 输出转成 bounded customer growth hints
- 严格限制：
  - 不改硬事实
  - 不改 primary segment
  - 只改 action preview / bounded score adjustment

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/customer-growth-bridge.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts`

Expected:

- PASS，world model 与 customer growth 主链接通

### Task 7: 打通夜间学习回灌

**Files:**
- Modify: `src/app/semantic-quality-service.ts`
- Modify: `src/app/conversation-review-service.ts`
- Modify: `src/ops/doctor.ts`
- Add: `src/world-model/learning.ts`
- Add: `src/world-model/learning.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 night review 能聚合：
  - 解释失真
  - 推演失真
  - 动作效果偏差
  - context gap
  - mechanism gap

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/learning.test.ts src/app/semantic-quality-service.test.ts src/ops/doctor.test.ts`

Expected:

- FAIL，因为当前夜间学习闭环还未覆盖 world model 偏差

**Step 3: Write minimal implementation**

- 新增 world model learning owner
- 把 nightly review 扩展为：
  - query gap
  - context gap
  - mechanism gap
  - decision gap
  - execution gap

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/learning.test.ts src/app/semantic-quality-service.test.ts src/ops/doctor.test.ts`

Expected:

- PASS，world model 学习闭环建立

### Task 8: 文档回写与聚合验证

**Files:**
- Modify: `docs/plans/2026-04-21-operating-world-model-v1-design.md`
- Modify: `docs/plans/2026-04-21-operating-world-model-v1-implementation-plan.md`
- Modify: `docs/plans/2026-04-21-operating-intelligence-full-stack-design.md`

**Step 1: 回写阶段状态**

- 标明：
  - 哪些是 v1 已做
  - 哪些仍是后续波次

**Step 2: 运行聚合验证**

Run:

- `pnpm exec vitest run src/world-model/types.test.ts src/world-model/state.test.ts src/world-model/mechanisms.test.ts src/world-model/simulator.test.ts`
- `pnpm exec vitest run src/world-model/rendering.test.ts src/world-model/customer-growth-bridge.test.ts src/world-model/learning.test.ts`
- `pnpm exec vitest run src/weekly-report.test.ts src/query-engine-renderer.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/app/semantic-quality-service.test.ts src/ops/doctor.test.ts`

Expected:

- world model 相关新增主链全部通过

**Step 3: 汇报结果**

- 说明 world model 已接入哪些读链
- 说明哪些能力仍需后续波次：
  - 更强行业态势层
  - 更细竞对 intelligence
  - 更强 counterfactual simulator
  - 更强总部战略层输出

Plan complete and saved to `docs/plans/2026-04-21-operating-world-model-v1-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
