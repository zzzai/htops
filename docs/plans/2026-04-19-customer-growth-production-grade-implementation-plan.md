# Customer Growth Production-Grade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把现有用户画像/分层/召回方案从 MVP 提升到 production-grade 的第一阶段，并先落地执行读链路 AI 治理与门店级调优入口。

**Architecture:** 保留 `feature -> strategy -> queue -> execution` owner path，不做大规模重写；通过 `AI gating + store-level tuning` 两个横切层，先解决线上稳定性与可调优性问题。第一批改造不改变整体数据流，只增加显式配置入口与安全边界。

**Tech Stack:** TypeScript, Vitest, repo-local config parser, customer growth owner modules

## 2026-04-21 补充回写

- 本计划的 `Task 1`-`Task 6` 已完成，当前主要承担 customer growth production shell 的记录
- 顾客经营画像 owner path、world model evidence、nightly customer profile review signals 已转入 `2026-04-21-customer-operating-profile-*` 文档继续推进
- 后续再回到本计划时，重点应放在更强容量模型、更细反馈学习回灌、更稳的 execution 收口

---

### Task 1: 执行读链路 AI advisory gating

状态：completed

**Files:**
- Modify: `src/customer-growth/reactivation/execution-service.ts`
- Modify: `src/app/reactivation-execution-service.test.ts`

**Step 1: Write the failing test**

- 为 `getExecutionSummary()` 增加回归测试，断言它不会因为备注存在而触发 `fetch`
- 为 `listExecutionTasks()` 增加显式 `includeAiAdvisory` 行为测试，断言只有在开启时才触发 followup summarizer

**Step 2: Run test to verify it fails**

Run: `npm test -- src/app/reactivation-execution-service.test.ts`

Expected:

- 现有测试不足以覆盖新约束，新增测试会先失败

**Step 3: Write minimal implementation**

- 给 `listExecutionTasks()` 增加显式 AI advisory 开关
- 给 `getExecutionSummary()` 固定走 `includeAiAdvisory: false`
- 保持任务列表可按需保留 AI summary，但不再让摘要查询触发全量模型调用

**Step 4: Run test to verify it passes**

Run: `npm test -- src/app/reactivation-execution-service.test.ts`

Expected:

- 新老测试全部通过

### Task 2: 门店级 customer growth tuning 配置入口

状态：completed

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

**Step 1: Write the failing test**

- 为 `resolveHetangOpsConfig()` 增加测试，验证 `stores[].customerGrowth` 可以解析
- 验证未配置时仍走默认值

**Step 2: Run test to verify it fails**

Run: `npm test -- src/config.test.ts`

Expected:

- 新增测试先失败，因为配置类型和 parser 尚未支持

**Step 3: Write minimal implementation**

- 给 `HetangStoreConfig` 增加 `customerGrowth` 子配置
- 先支持 `primarySegmentThresholds` 这一批最关键阈值
- parser 中补齐数值解析与默认兜底

**Step 4: Run test to verify it passes**

Run: `npm test -- src/config.test.ts`

Expected:

- 新增测试通过，原有 config 测试不回归

### Task 3: 主分层接入 tuning layer

状态：completed

**Files:**
- Modify: `src/customer-growth/semantics.ts`
- Modify: `src/customer-growth/intelligence.ts`
- Modify: `src/customer-intelligence.test.ts`
- Modify: `src/report.ts`
- Modify: `src/app/sync-service.ts`
- Modify: `src/rebuild-customer-history-local-script.ts`
- Modify: `src/report-build.test.ts`
- Modify: `src/app/sync-service.test.ts`
- Modify: `src/rebuild-customer-history-local-script.test.ts`

**Step 1: Write the failing test**

- 为主分层增加“门店级阈值覆盖”的行为测试
- 验证默认阈值不变，覆盖阈值后分层结果会跟随变化

**Step 2: Run test to verify it fails**

Run: `npm test -- src/customer-intelligence.test.ts`

Expected:

- 新增测试失败，因为当前主分层只读硬编码常量，且调用链还未传入 store config

**Step 3: Write minimal implementation**

- 把主分层阈值从纯常量升级为 `defaults + optional tuning overrides`
- 通过 store config 把 tuning 传到主分层解析函数

**Step 4: Run test to verify it passes**

Run: `npm test -- src/customer-intelligence.test.ts src/report-build.test.ts src/app/sync-service.test.ts src/rebuild-customer-history-local-script.test.ts`

Expected:

- 新增测试通过，默认行为不变

### Task 4: 文档回写与验证

状态：completed

**Files:**
- Modify: `docs/plans/2026-04-19-customer-growth-production-grade-design.md`
- Modify: `docs/plans/2026-04-19-customer-growth-production-grade-implementation-plan.md`

**Step 1: 回写已完成项**

- 将本轮已落地项标记为 in-progress / completed

**Step 2: 运行定向验证**

Run:

- `npm test -- src/app/reactivation-execution-service.test.ts`
- `npm test -- src/config.test.ts`
- `npm test -- src/customer-intelligence.test.ts src/report-build.test.ts src/app/sync-service.test.ts src/rebuild-customer-history-local-script.test.ts`

**Step 3: 如有必要再跑聚合验证**

Run:

- `npm test -- src/config.test.ts src/customer-intelligence.test.ts src/report-build.test.ts src/app/sync-service.test.ts src/rebuild-customer-history-local-script.test.ts`

**Step 4: 汇报结果**

- 说明实际执行命令
- 说明未完成的后续批次：多人单归因、反馈学习回灌、容量感知优先级

### Task 5: 多人稳定客户消费单安全归因

状态：completed

**Files:**
- Modify: `src/customer-growth/intelligence.ts`
- Modify: `src/customer-growth/reactivation/features.ts`
- Modify: `src/customer-intelligence.test.ts`
- Modify: `src/reactivation-features.test.ts`

**Step 1: Write the failing test**

- 为 `buildCustomerSegments()` 增加多人稳定客户共享消费单场景，验证不会把整单金额重复记到每个人
- 为 `buildCustomerConversionCohorts()` 增加多人稳定客户共享首单团购场景，验证不会错误开启个人 cohort
- 为 `buildMemberReactivationFeaturesForBizDate()` 增加多人会员共享消费单场景，验证不会均分会员支付额和到店时间行为

**Step 2: Run test to verify it fails**

Run: `npm test -- src/customer-intelligence.test.ts src/reactivation-features.test.ts`

Expected:

- 新增测试失败，证明当前多人单会污染个人画像与召回特征

**Step 3: Write minimal implementation**

- 在 customer intelligence 中引入保守型安全归因：只有“单一稳定客户”才进入个人消费归因
- 在 reactivation features 中只对“单一可识别会员”归因会员支付额和 visit event
- 保留多人单原始事实，但不让其直接进入个人经营算分

**Step 4: Run test to verify it passes**

Run:

- `npm test -- src/customer-intelligence.test.ts src/reactivation-features.test.ts`
- `npm test -- src/customer-query.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-profile.test.ts`

Expected:

- 新增测试通过
- customer growth 主链相关测试不回归

### Task 6: 执行反馈学习快照与 bounded calibration

状态：completed

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/customer-growth/reactivation/execution-service.ts`
- Add: `src/customer-growth/reactivation/learning.ts`
- Add: `src/customer-growth/reactivation/learning.test.ts`
- Add: `src/store-reactivation-learning.test.ts`
- Modify: `src/app/reactivation-execution-service.test.ts`
- Modify: `src/customer-growth/reactivation/strategy.ts`
- Modify: `src/reactivation-strategy.test.ts`

**Step 1: Write the failing test**

- 为 feedback write path 增加测试，验证 `upsertExecutionFeedback()` 会在写事实后同步落一条 `reactivation outcome snapshot`
- 为 learning owner module 增加测试，验证执行反馈会被归一化成 `outcomeLabel / outcomeScore / note signals`
- 为 strategy 增加测试，验证近 90 天历史 outcome snapshot 只会对 `primarySegment + recommendedActionLabel` 产生 bounded calibration
- 为 store 增加测试，验证 outcome snapshot 可以持久化并按日期范围读取

**Step 2: Run test to verify it fails**

Run:

- `npm test -- src/app/reactivation-execution-service.test.ts src/customer-growth/reactivation/learning.test.ts src/store-reactivation-learning.test.ts src/reactivation-strategy.test.ts`

Expected:

- 新增测试先失败，因为当前还没有 learning owner module、snapshot storage 和 strategy calibration

**Step 3: Write minimal implementation**

- 新增 `src/customer-growth/reactivation/learning.ts`，把 execution feedback 归一化为 `reactivation outcome snapshot`
- 在 `ops_member_reactivation_feedback` 旁边新增 `mart_member_reactivation_outcome_snapshots_daily`
- `upsertExecutionFeedback()` 在写反馈后读取对应 queue row，生成 snapshot，并在有配置时调用 bounded AI followup summarizer 只补充 learning json
- strategy 重建时读取近 90 天 outcome snapshots，只对 `strategyPriorityScore` 增加 bounded `adjustmentScore`，不改 `recommendedActionLabel / primarySegment / feedbackStatus`

**Step 4: Run test to verify it passes**

Run:

- `npm test -- src/app/reactivation-execution-service.test.ts src/customer-growth/reactivation/learning.test.ts src/store-reactivation-learning.test.ts src/reactivation-strategy.test.ts`
- `npm test -- src/store-reactivation-learning.test.ts src/app/reactivation-execution-service.test.ts src/customer-growth/reactivation/learning.test.ts src/reactivation-strategy.test.ts src/rebuild-customer-history-local-script.test.ts src/app/sync-service.test.ts`

Expected:

- learning owner、write path、strategy rebuild、store persistence 相关测试全部通过
- sync/local rebuild 链不回归

### Task 7: 容量感知 priority band 首批落地

状态：completed

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`
- Modify: `src/reactivation-queue.test.ts`
- Modify: `src/rebuild-customer-history-local-script.ts`

**Step 1: Write the failing test**

- 为 config 增加测试，验证 `store.customerGrowth.reactivationCapacity.dailyTouchCapacity` 可以被解析
- 为 queue 增加测试，验证存在 `dailyTouchCapacity` 时，P0/P1/P2/P3 会按门店日触达容量分带
- 为 queue build 增加测试，验证 `buildMemberReactivationQueueForBizDate()` 真正吃到 store-level capacity config

**Step 2: Run test to verify it fails**

Run:

- `npm test -- src/config.test.ts src/reactivation-queue.test.ts`

Expected:

- 新增测试先失败，因为当前只有相对排名分带，没有 capacity-aware banding

**Step 3: Write minimal implementation**

- 在 `HetangStoreCustomerGrowthConfig` 中补 `reactivationCapacity.dailyTouchCapacity`
- queue owner 新增 `estimateDailyTouchCapacity()`，优先读显式配置，没有则按 `roomCount + operatingHoursPerDay` 做保守估算
- `resolveMemberReactivationPriorityBand()` 改为“容量优先、缺省回退老逻辑”
- local catchup descriptor 补 `customerGrowth` 透传，保证 queue rebuild 真能吃到门店容量配置

**Step 4: Run test to verify it passes**

Run:

- `npm test -- src/config.test.ts src/reactivation-queue.test.ts`
- `npm test -- src/config.test.ts src/reactivation-queue.test.ts src/rebuild-customer-history-local-script.test.ts src/app/sync-service.test.ts`

Expected:

- config parser、queue owner、local/sync rebuild 相关测试全部通过
- 无容量配置的门店仍保持原有相对分带行为
