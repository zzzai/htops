# Hetang Demand Clock v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 `htops` 架构上落地荷塘经营版 `需求时钟 + 承接时钟 + 动作时钟` 初版，让系统能稳定识别分时段需求强弱、供需错配和动作窗口，并进入日报、周报、召回与世界模型读链。

**Architecture:** 保持 `fact -> mart -> serving -> rendering` 主链不变。先基于现有消费单、到店时段、排班/等待、客户召回特征构建 4 段 daypart 版 demand clock，不引入第二套 runtime，不直接上深度时序模型。外部环境与门店主数据只做 bounded soft adjustment，不覆盖内部事实。

**Tech Stack:** TypeScript, PostgreSQL, Vitest, current customer-growth modules, current reporting modules, current world-model modules

---

### Task 1: 明确定义 Demand Clock 的类型与 daypart 口径

**Files:**
- Modify: `src/types.ts`
- Add: `src/customer-growth/demand-clock.ts`
- Add: `src/customer-growth/demand-clock.test.ts`

**Step 1: Write the failing test**

- 在 `src/customer-growth/demand-clock.test.ts` 中增加测试
- 断言系统存在统一 daypart 类型与 clock 输出结构：
  - `afternoon`
  - `after-work`
  - `late-night`
  - `overnight`
- 断言 `buildDemandClockSkeleton()` 至少产出：
  - `demandClock`
  - `intakeClock`
  - `actionClock`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/demand-clock.test.ts`

Expected:

- FAIL，因为当前没有统一的 demand clock owner module

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 中补足 demand clock 相关类型
- 在 `src/customer-growth/demand-clock.ts` 中先落一个纯类型与骨架构建器
- 保持与当前 `reactivation/features.ts` 的 daypart 定义一致，不另造一套 bucket

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/demand-clock.test.ts`

Expected:

- PASS，daypart 口径和 clock 结构统一

**Step 5: Commit**

```bash
git add src/types.ts src/customer-growth/demand-clock.ts src/customer-growth/demand-clock.test.ts
git commit -m "feat: add demand clock core types"
```

### Task 2: 增加门店分时段需求快照表

**Files:**
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 在 `src/store.test.ts` 中增加 daypart demand snapshot 测试
- 断言 `store.initialize()` 会创建：
  - `mart_store_daypart_demand_snapshots_daily`
- 断言可写入并读取字段：
  - `org_id`
  - `biz_date`
  - `daypart`
  - `arrival_count`
  - `revenue_amount`
  - `add_on_rate`
  - `select_tech_rate`
  - `new_member_count`
  - `recharge_amount`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store daypart demand snapshots"`

Expected:

- FAIL，因为当前没有统一 daypart 需求快照表

**Step 3: Write minimal implementation**

- 在 `src/store.ts` 中新增表定义、索引与 owner store 读写方法
- 在 `src/types.ts` 中新增 snapshot 类型
- 保持字段只覆盖 v1 所需，不提前把所有未来想象都塞进去

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store daypart demand snapshots"`

Expected:

- PASS，需求时钟有正式数据落点

**Step 5: Commit**

```bash
git add src/store.ts src/types.ts src/store.test.ts
git commit -m "feat: add store daypart demand snapshots"
```

### Task 3: 从消费单重建 daypart 需求快照

**Files:**
- Add: `src/customer-growth/demand-clock-rebuild.ts`
- Add: `src/customer-growth/demand-clock-rebuild.test.ts`
- Modify: `src/customer-growth/query.ts`
- Modify: `src/arrival-profile-query.ts`

**Step 1: Write the failing test**

- 为重建器增加测试
- 给一组跨多个 daypart 的消费单 fixture
- 断言重建后能正确产出：
  - 到店人数
  - 营收金额
  - 各时段日均分布

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/demand-clock-rebuild.test.ts`

Expected:

- FAIL，因为当前 arrival profile 只做读时聚合，没有稳定的快照重建层

**Step 3: Write minimal implementation**

- 在 `src/customer-growth/demand-clock-rebuild.ts` 中复用当前 operational biz day 与 hour->daypart 映射
- 先按消费单生成 daypart demand snapshot
- 不做复杂预测，只做稳定统计汇总

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/demand-clock-rebuild.test.ts`

Expected:

- PASS，需求快照可由已有事实稳定重建

**Step 5: Commit**

```bash
git add src/customer-growth/demand-clock-rebuild.ts src/customer-growth/demand-clock-rebuild.test.ts src/customer-growth/query.ts src/arrival-profile-query.ts
git commit -m "feat: rebuild daypart demand snapshots from consume facts"
```

### Task 4: 增加 daypart 供给与承接快照

**Files:**
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Add: `src/customer-growth/daypart-intake.ts`
- Add: `src/customer-growth/daypart-intake.test.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 增加供给/承接快照测试
- 断言存在：
  - `mart_store_daypart_intake_snapshots_daily`
- 断言字段至少支持：
  - `room_capacity_share`
  - `staffing_capacity_share`
  - `average_wait_minutes`
  - `peak_wait_minutes`
  - `intake_feasibility_score`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store daypart intake snapshots"`

Expected:

- FAIL，因为当前没有统一 daypart 承接快照层

**Step 3: Write minimal implementation**

- 在 `src/store.ts` 中新增表定义与读写方法
- 在 `src/customer-growth/daypart-intake.ts` 中先用现有等待、营业时长、房间数、排班/供给信号构造 v1 intake snapshot
- 对缺失数据显式降权，不要硬算满分

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store daypart intake snapshots" src/customer-growth/daypart-intake.test.ts`

Expected:

- PASS，承接时钟有正式数据落点

**Step 5: Commit**

```bash
git add src/store.ts src/types.ts src/customer-growth/daypart-intake.ts src/customer-growth/daypart-intake.test.ts src/store.test.ts
git commit -m "feat: add daypart intake snapshots"
```

### Task 5: 计算 Demand TGI 与供需错配

**Files:**
- Modify: `src/customer-growth/demand-clock.ts`
- Modify: `src/customer-growth/demand-clock.test.ts`
- Add: `src/customer-growth/demand-gap.ts`
- Add: `src/customer-growth/demand-gap.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证：
  - `DemandTGI`
  - `Gap`
  - `MissedDemandRisk`
- 给一组 demand/intake fixture，断言：
  - 高需求低供给时 `Gap > 0`
  - 低需求高供给时 `Gap < 0`
  - `TGI > 100` 时说明时段相对偏强

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/demand-clock.test.ts src/customer-growth/demand-gap.test.ts`

Expected:

- FAIL，因为当前还没有统一的 clock score 和 gap 计算

**Step 3: Write minimal implementation**

- 在 `src/customer-growth/demand-clock.ts` 中加入 TGI 计算
- 在 `src/customer-growth/demand-gap.ts` 中加入 gap 与 missed demand risk
- 先做 deterministic 统计计算，不引入机器学习

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/demand-clock.test.ts src/customer-growth/demand-gap.test.ts`

Expected:

- PASS，时段需求强弱与错配可量化

**Step 5: Commit**

```bash
git add src/customer-growth/demand-clock.ts src/customer-growth/demand-clock.test.ts src/customer-growth/demand-gap.ts src/customer-growth/demand-gap.test.ts
git commit -m "feat: add demand tgi and gap scoring"
```

### Task 6: 加入分时段动作时钟

**Files:**
- Modify: `src/customer-growth/reactivation/strategy.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`
- Test: `src/reactivation-strategy.test.ts`
- Test: `src/reactivation-queue.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证动作时钟会综合：
  - 客户偏好时段
  - 门店需求强度
  - 承接可行性
  - 环境上下文
- 断言在“高需求但低承接”时，系统不会盲目放大触达
- 断言在“高需求且高承接”时，会抬高对应时段动作优先级

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/reactivation-strategy.test.ts src/reactivation-queue.test.ts`

Expected:

- FAIL，因为当前动作推荐主要看个人历史偏好与有限环境信号

**Step 3: Write minimal implementation**

- 在现有 reactivation strategy 上加一层 daypart action adjustment
- 保持 bounded：
  - 不推翻现有优先级骨架
  - 只做时段动作修正

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/reactivation-strategy.test.ts src/reactivation-queue.test.ts`

Expected:

- PASS，动作时钟进入召回路径

**Step 5: Commit**

```bash
git add src/customer-growth/reactivation/strategy.ts src/customer-growth/reactivation/queue.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts
git commit -m "feat: add demand clock action adjustments"
```

### Task 7: 接入日报、周报与查询解释链

**Files:**
- Modify: `src/report.ts`
- Modify: `src/weekly-report.ts`
- Modify: `src/query-engine-renderer.ts`
- Modify: `src/store-query.ts`
- Test: `src/report.test.ts`
- Test: `src/weekly-report.test.ts`
- Test: `src/query-engine-renderer.test.ts`
- Test: `src/store-query.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证：
  - 日报可显示“哪段需求最强 / 哪段没接住”
  - 周报可显示“本周关键时段机会与错配”
  - 门店 query 可输出 daypart diagnosis

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/report.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts src/store-query.test.ts`

Expected:

- FAIL，因为现有输出层还没有统一 demand clock narrative

**Step 3: Write minimal implementation**

- 在 rendering 层加简洁、可执行的叙述：
  - 哪段强
  - 哪段漏
  - 今天先抓哪段
- 不输出复杂模型名词给店长

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/report.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts src/store-query.test.ts`

Expected:

- PASS，需求时钟进入经营输出面

**Step 5: Commit**

```bash
git add src/report.ts src/weekly-report.ts src/query-engine-renderer.ts src/store-query.ts src/report.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts src/store-query.test.ts
git commit -m "feat: surface demand clock insights in reports and queries"
```

### Task 8: 接入世界模型与解释推演层

**Files:**
- Modify: `src/world-model/state.ts`
- Modify: `src/world-model/mechanisms.ts`
- Modify: `src/world-model/rendering.ts`
- Test: `src/world-model/state.test.ts`
- Test: `src/world-model/mechanisms.test.ts`
- Test: `src/world-model/rendering.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 world model snapshot 能包含：
  - demand clock summary
  - intake clock summary
  - action clock summary
- 验证 mechanism layer 可表达：
  - 高需求低承接
  - 晚场机会放大
  - 深夜误推风险

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/state.test.ts src/world-model/mechanisms.test.ts src/world-model/rendering.test.ts`

Expected:

- FAIL，因为当前 world model 还没有 demand clock 这一层

**Step 3: Write minimal implementation**

- 把 demand/intake/action clock 作为 bounded supplement 接到 world state
- 只用于解释与动作预览，不允许弱信号直接改主评分

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/state.test.ts src/world-model/mechanisms.test.ts src/world-model/rendering.test.ts`

Expected:

- PASS，需求时钟进入世界模型

**Step 5: Commit**

```bash
git add src/world-model/state.ts src/world-model/mechanisms.ts src/world-model/rendering.ts src/world-model/state.test.ts src/world-model/mechanisms.test.ts src/world-model/rendering.test.ts
git commit -m "feat: integrate demand clock into world model"
```

### Task 9: 加入显著性验证与分层稳定性检查

**Files:**
- Add: `src/customer-growth/demand-clock-stats.ts`
- Add: `src/customer-growth/demand-clock-stats.test.ts`
- Modify: `src/customer-growth/demand-clock.ts`

**Step 1: Write the failing test**

- 为统计验证模块增加测试
- 断言支持：
  - 卡方检验输入格式
  - TGI 平滑
  - 小样本降权标签
- 断言小样本时不会输出过强结论

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/demand-clock-stats.test.ts`

Expected:

- FAIL，因为当前没有 demand clock 统计验证模块

**Step 3: Write minimal implementation**

- 实现一个 bounded stats helper
- 先不做复杂科研包，只做项目内可控统计：
  - min sample threshold
  - smoothed TGI
  - significance hint

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/demand-clock-stats.test.ts`

Expected:

- PASS，需求时钟具备最基本的验证边界

**Step 5: Commit**

```bash
git add src/customer-growth/demand-clock-stats.ts src/customer-growth/demand-clock-stats.test.ts src/customer-growth/demand-clock.ts
git commit -m "feat: add demand clock stats validation"
```

### Task 10: 端到端验证

**Files:**
- Verify only

**Step 1: Run focused clock tests**

Run:

```bash
pnpm exec vitest run src/customer-growth/demand-clock.test.ts src/customer-growth/demand-clock-rebuild.test.ts src/customer-growth/daypart-intake.test.ts src/customer-growth/demand-gap.test.ts src/customer-growth/demand-clock-stats.test.ts
```

Expected:

- PASS，需求时钟核心能力通过

**Step 2: Run impacted business-surface tests**

Run:

```bash
pnpm exec vitest run src/store.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/report.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts src/store-query.test.ts src/world-model/state.test.ts src/world-model/mechanisms.test.ts src/world-model/rendering.test.ts
```

Expected:

- PASS，读链与动作链兼容

**Step 3: Run TypeScript check**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`

Expected:

- 若失败，需明确区分新增错误与仓库既有错误

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add hetang demand clock v1"
```

---

Plan complete and saved to `docs/plans/2026-04-21-hetang-demand-clock-v1-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
