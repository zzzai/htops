# Hetang Capability Graph Runtime + Async Slice

**Goal:** 在 Capability Graph v1 的 `serving_sql` 基础上，把 `report / trend / anomaly / risk / advice` 这些 narrative 能力，以及第一批 `async_analysis` 能力，一起纳入统一 graph。

## What Changed

本次继续演进后，graph 不再只是 SQL 能力注册表。

新增了 `runtime_render` 节点类型，并把以下能力正式纳入 graph：

- `store_report_v1`
- `store_trend_v1`
- `store_anomaly_v1`
- `store_risk_v1`
- `store_advice_v1`

同时，`query-plan.ts` 已经把这些问题正式计划化：

- `report`
- `trend`
- `anomaly`
- `risk`
- `advice`

本轮继续把第一批 `async_analysis` 节点纳入 graph：

- `store_review_async_v1`
- `portfolio_store_review_async_v1`

并且把 `capabilityId` 从 analysis routing 一直带进 analysis queue，后续异步执行、审计、命中率统计都不需要再回头猜原始路由。

## Why This Matters

这一步的意义不是“多加几个节点”，而是：

1. graph 开始覆盖“回答能力”，而不只是“SQL 能力”
2. narrative 能力和 serving 能力第一次进入同一个 plan/graph 语义空间
3. 后续 `report -> breakdown -> risk -> action` 的多步能力编排才有统一底座

## Current Boundary

目前已经做到：

- `buildQueryPlanFromIntent()` 可输出非 SQL narrative action
- `capability-graph.ts` 可选择 `runtime_render` 节点
- `resolveAsyncAnalysisCapability()` 可选择第一批异步复盘节点
- `command.ts / inbound.ts / runtime / analysis queue` 已保留 `capabilityId`
- `message-entry-service` 暴露的 graph node count 已包含 serving / runtime_render / async_analysis 三类节点

目前还没做到：

- query-engine 全链路统一消费 runtime_render graph 选择结果
- action schema 独立出 renderer
- async analysis worker 真正按 graph node 做执行策略分发，而不只是队列打标

## Next Best Step

下一步最值钱的是把 graph 继续从“能力选择”推进到“执行编排”，形成稳定闭环：

- `serving_sql`
- `runtime_render`
- `async_analysis`

这样 `htops` 的 graph 才会真正从“查询图”升级成“回答与行动图”，并开始承接后续 Capability Graph v2 的命中审计、降级统计和多步编排。
