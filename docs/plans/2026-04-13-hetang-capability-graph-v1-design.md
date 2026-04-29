# Hetang Capability Graph V1 Design

**Goal:** 在不推翻现有 `Text -> Semantic Intent -> Plan -> Safe SQL` 链路的前提下，把当前平面的 capability registry 升级成一个真正可演进的 Capability Graph v1。

## Why

当前 `htops` 已经有：

- `query-semantics.ts` / `query-intent.ts` 的语义理解层
- `query-plan.ts` 的结构化查询计划层
- `capability-registry.ts` 的 capability 白名单
- `sql-compiler.ts` + `serving_*` 的安全执行层

缺口在于 capability 仍然是“平的”：

- 没有正式的前置条件模型
- 没有下游能力关系
- 没有回退关系
- 没有统一的 execution/output 元数据

结果就是系统虽然已经能答很多问题，但还不够像一个真正的“能力内核”。

## Scope

Capability Graph v1 只做三件事：

1. 引入统一的 `CapabilityNode` 图模型
2. 让现有 serving query plane 改为从 graph 选能力，而不是直接扫平面 registry
3. 把图谱快照暴露给 bridge/message-entry introspection，方便运维与后续 UI/agent 集成

本次不做：

- 多跳自动计划执行
- AI 直接生成 capability graph
- 非 serving 能力的统一执行器
- report / advice / async analysis 的完全图谱化

## Architecture

### 1. Capability Graph as the source of truth

新增 `src/capability-graph.ts`，定义统一节点模型：

- `capability_id`
- `entity`
- `action`
- `execution_mode`
- `output_kind`
- `supported_metrics`
- `supported_time_modes`
- `supported_dimensions`
- `supported_response_shapes`
- `max_org_count`
- `serving_surface`
- `sql_family`
- `downstream_capability_ids`
- `fallback_capability_ids`

V1 先只覆盖 `serving_sql` 节点。

### 2. capability-registry becomes a compatibility facade

现有 `src/capability-registry.ts` 不再自己维护真相，而是改成 graph 的兼容门面：

- `listServingCapabilities()`
- `resolveServingCapability(plan)`

这样旧调用方不需要大改，但内核已切换到 graph。

### 3. Query plane starts consuming graph resolution

`query-engine.ts` 的 serving fast path 改为：

- `plan`
- `resolveCapabilityGraphSelection(plan)`
- `compileServingQuery`
- `execute`
- `render`

这样 capability 选择逻辑集中到 graph，而不再散落在 registry 过滤器里。

### 4. Bridge introspection exposes graph version

`message-entry-service.ts` 的 `describeCapabilities()` 增加：

- `query_graph_version`
- `serving_capability_count`
- `capability_node_count`

这让 Hermes / 运维 / 后续 Playground 能看见当前内核能力版本。

## Initial Node Set

V1 先纳入现有 serving 节点：

- `store_day_summary_v1`
- `store_day_clock_breakdown_v1`
- `store_window_summary_v1`
- `store_window_ranking_v1`
- `hq_window_ranking_v1`
- `customer_profile_lookup_v1`
- `customer_ranked_list_lookup_v1`

并显式定义第一批关系：

- `store_day_clock_breakdown_v1`
  downstream:
  - `store_day_summary_v1`
  - `store_window_summary_v1`
  fallback:
  - `store_day_summary_v1`

这代表系统已经能表达：

- 先拆解昨天钟数
- 不够就退回昨天摘要
- 再继续下钻到近 7/30 天经营判断

## Why This Version Is Worth Shipping

它不是概念重构，而是一个“低风险、立即可用”的架构升级：

- 不改动 SQL 安全边界
- 不改动现有 query-engine 主体结构
- 不推翻现有 capability id
- 先把真正缺失的 graph 语义补上

这会为后续两件事打基础：

1. `Capability Graph v2`
   把 report / advice / async analysis 纳入统一 graph
2. `Semantic Multi-Step Planner`
   让复杂问题按 graph 做多步能力编排

## Success Criteria

- 新增 graph 模块有测试
- 现有 serving capability 解析由 graph 提供
- `store day breakdown` 可以通过 graph 精确命中
- bridge capability 响应能看到 graph 版本信息
- 现有核心查询与 runtime 回归测试保持通过
