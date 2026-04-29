# Customer Growth Directory And AI Design

日期：2026-04-19
状态：approved
范围：用户画像、标签、分层、召回链路独立 owner 目录；在不改变安全主决策边界的前提下，为各环节引入可控 AI advisory layer

## 背景

当前“用户画像 -> 标签 -> 分层 -> 召回特征 -> 召回策略 -> 召回队列 -> 执行反馈”已经形成可见、可验、可回写的最小闭环，但相关模块仍分散在 `src/` 根目录，AI 能力也主要集中在入口语义补槽、analysis bounded synthesis、external intelligence narrative，并未形成 customer growth 领域内的统一 owner 边界。

用户希望继续推进两件事：

1. 把画像/分层/召回项目单独收成独立文件目录
2. 尽量把 AI 能力融入各个环节

本设计采用中等重构路径：

- 把 customer growth 主链收成单独 owner 目录
- 允许短期兼容导出，但新逻辑只进入 owner 目录
- AI 第一阶段只提供结构化 advisory，不直接改写 `primarySegment`、`reactivationPriorityScore`、`priorityBand`

## 目标

### 目标内

- 建立 `src/customer-growth/` 作为画像/标签/分层/召回主链 owner 目录
- 收拢共享 helper，如节气/天气环境上下文、birthday utils、customer semantics
- 为画像、标签、分层、召回策略、执行反馈补入统一 AI advisory contracts
- 把 query、tools、reporting、sync 这些真实调用入口切到新 owner 目录
- 保持现有 scheduled worker / bridge / query 主链可继续 smoke

### 目标外

- 不把 customer growth 主链整体改成 AI-first orchestration
- 不新增第二套 ontology/runtime
- 不让 AI 直接写动作、直接修改排序或越过现有 safe execution
- 第一阶段不强依赖新增数据库表

## 设计原则

1. owner module first
   - customer growth 新逻辑只进入 `src/customer-growth/`
   - 根目录旧文件只允许做短期兼容转发，不继续长逻辑演化

2. deterministic kernel first
   - `primarySegment`
   - `reactivationPriorityScore`
   - `strategyPriorityScore`
   - `priorityBand`
   以上仍由确定性规则内核负责

3. AI as bounded advisor
   - AI 只返回结构化 JSON
   - AI 结果只作为解释、补充信号、策略建议、备注总结
   - AI 失败不影响主链可用性

4. migration without downtime
   - 先迁目录与调用入口
   - 再接 AI client
   - 再逐环节开启 feature flag

## 目标目录

建议新增：

```text
src/customer-growth/
  intelligence.ts
  profile.ts
  query.ts
  semantics.ts
  history-backfill.ts
  environment-context.ts
  birthday-utils.ts
  reactivation/
    features.ts
    strategy.ts
    queue.ts
    push.ts
    execution-service.ts
  ai/
    contracts.ts
    client.ts
    profile-insight.ts
    tag-advisor.ts
    strategy-advisor.ts
    followup-summarizer.ts
```

第一阶段需要迁入或收拢的现有模块：

- `src/customer-intelligence.ts`
- `src/customer-profile.ts`
- `src/customer-query.ts`
- `src/customer-semantics.ts`
- `src/customer-history-backfill.ts`
- `src/environment-context.ts`
- `src/birthday-utils.ts`
- `src/reactivation-features.ts`
- `src/reactivation-strategy.ts`
- `src/reactivation-queue.ts`
- `src/reactivation-push.ts`
- `src/app/reactivation-execution-service.ts`

## 调用入口改造

以下入口需要切到新的 owner 目录：

- sync：`src/app/sync-service.ts`
- query runtime：`src/query-engine-executor.ts`
- tools：`src/tools/handlers.ts`
- reporting：`src/app/reporting-service.ts`
- 其他直接依赖 customer growth helper 的模块，如 `report.ts`、`metrics.ts`、`store-query.ts`

为了平滑迁移，第一阶段允许保留根目录兼容文件，例如：

- `src/customer-intelligence.ts`
- `src/reactivation-strategy.ts`

这些文件内部仅做 re-export，真正实现迁入 `src/customer-growth/`。第二阶段再逐步移除兼容层。

## AI 能力融入方案

### 1. 画像环节

由 AI 输出结构化画像补充：

- `profileNarrative`
- `highValueSignals`
- `riskSignals`
- `missingFacts`

用途：

- 对外展示更自然的画像说明
- 辅助店长理解“为什么是这个客户”
- 不替代当前画像事实字段

### 2. 标签环节

由 AI 输出：

- `softTags`
- `tagHypotheses`
- `tagReasons`

边界：

- 不覆盖现有 `tagKeys`
- 只作为“建议标签”和解释层

### 3. 分层环节

由 AI 输出：

- `segmentReview`
- `segmentWhy`
- `counterSignals`

边界：

- 不直接改 `primarySegment`
- 先作为分层复核与人工核查提示

### 4. 召回策略环节

由 AI 输出：

- `contactAngle`
- `talkingPoints`
- `offerGuardrails`
- `doNotPushFlags`

边界：

- 不直接改 `strategyPriorityScore`
- 不直接改 `priorityBand`
- 只增强“怎么联系、说什么、别踩什么坑”

### 5. 执行反馈环节

由 AI 输出：

- `outcomeSummary`
- `objectionLabels`
- `nextBestAction`
- `followupDraft`

用途：

- 把员工自由备注转成结构化反馈
- 反哺后续召回与 doctor 复盘

## 数据落点

第一阶段不新增强依赖表，优先把 AI advisory 写入现有 JSON 字段：

- `CustomerSegmentRecord.rawJson`
- `MemberReactivationFeatureRecord.featureJson`
- `MemberReactivationStrategyRecord.strategyJson`
- `MemberReactivationQueueRecord.queueJson`

建议写入结构：

```json
{
  "aiAdvisory": {
    "version": "customer-growth-ai-v1",
    "updatedAt": "2026-04-19T10:00:00.000Z",
    "profileInsight": {},
    "tagAdvisor": {},
    "strategyAdvisor": {},
    "followupSummary": {}
  }
}
```

这样可以：

- 不破坏现有 schema
- 先把 AI 结果挂进 query / tools / reporting
- 后续再根据价值决定是否升格为一等字段

## 配置设计

新增独立配置块：

- `customerGrowthAi.enabled`
- `customerGrowthAi.baseUrl`
- `customerGrowthAi.apiKey`
- `customerGrowthAi.model`
- `customerGrowthAi.timeoutMs`
- `customerGrowthAi.profileInsight.enabled`
- `customerGrowthAi.tagAdvisor.enabled`
- `customerGrowthAi.strategyAdvisor.enabled`
- `customerGrowthAi.followupSummarizer.enabled`

不复用 `semanticFallback`，原因是：

- 语义补槽与业务 advisory 的 SLA、开关、风险边界不同
- 后续需要单独观测命中率、降级率、生成成功率

## 运行边界

### 允许 AI 做的事

- 结构化解释
- 结构化建议
- 备注摘要
- 风险提示
- 软标签与复核意见

### 不允许 AI 做的事

- 直接执行系统动作
- 直接改客户主分层
- 直接改 P0/P1/P2 主排序
- 覆盖天气、节气、会员余额、消费事实等确定性字段

## 失败与降级

每个 AI advisory module 都必须支持：

- config 关闭时直接跳过
- 超时失败时返回 `null`
- 非法 JSON 时返回 `null`
- 上游失败时记录 warn log，但不影响主链结果

输出层要能显式区分：

- `usedAi: true`
- `usedAi: false`
- `fallbackReason`

## 观测与质量

第一阶段至少补三类观测：

1. advisory invocation
   - 哪个模块调用了 AI
   - 成功/失败/跳过

2. advisory coverage
   - 有多少画像/策略/反馈拿到了 AI 附加结果

3. advisory quality sampling
   - 抽样沉淀到 doctor / review 的候选信号

## 实施顺序

### Phase 1

- 建目录
- 迁实现
- 保留兼容 re-export
- 调整真实调用入口
- 行为不变

### Phase 2

- 新增 `customerGrowthAi` config
- 落地通用 AI client / contracts
- 接入 profile insight、strategy advisor、followup summarizer

### Phase 3

- 把 advisory 接入 query / tools / reporting 展示
- 补 doctor / quality 观测
- 再评估是否让部分 advisory 进入更强的排序特征层

## 风险

1. 目录迁移导致 import 面过广
   - 通过兼容 re-export 缓冲

2. AI 返回不稳定
   - 强制 JSON contract + fail closed

3. AI advisory 影响业务判断
   - 第一阶段只读附加，不改主排序

4. 线上 smoke 链路被目录改造打断
   - 优先保障 `summary / tasks / update` 命令链测试与 smoke

## 成功标准

- customer growth 主链实现进入 `src/customer-growth/`
- 现有 query / tools / reporting / sync 可继续通过核心测试
- 画像解释、召回建议、反馈总结能在开关打开时返回结构化 AI advisory
- AI 挂掉时，原有 deterministic 链路仍完整可用
