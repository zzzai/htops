# Hetang Current Optimal Architecture Design

## Goal

在当前 `10 店` 规模下，把 Hetang 项目收敛成一套“现在就稳、查询够快、以后能扩”的最优架构：继续以 `PostgreSQL` 为核心数仓，不引入主从和新 OLAP 引擎，但正式引入 `Serving Layer + QueryPlan + Capability Registry + SQL Compiler`，让高频问题走确定性快速链路，复杂问题保留旧链路或异步扩展空间。

## Current Constraints

1. 外部 API 只有凌晨 `03:00-04:00` 可用，没有实时流式入口。
2. 当前核心诉求是“查询快反馈”，不是实时事件分析。
3. 现状门店规模是 `10 店`，但未来需要能平滑走向更多门店。
4. 当前系统已具备：
   - PostgreSQL 事实表和快照表
   - 顾客画像、技师画像、HQ 看盘、经营复盘
   - 规则语义层和 AI 语义兜底层
5. 当前主要问题不是“有没有数据”，而是：
   - 在线链路仍有现算和现拼
   - 新问题支持仍偏 handler 化
   - 物化视图仍是核心 serving 面
   - 缺少正式的查询计划和能力注册层

## Architecture Decision

当前最优解不是上 Pinot、不是上主从，也不是让 AI 自由写 SQL。

当前最优解是：

1. `PostgreSQL` 继续做唯一权威仓。
2. 夜间批处理负责：
   - 原始入仓
   - 快照固化
   - 增量派生
   - serving 发布
3. 白天问答主链只读 `serving_*` 面，不触发 rebuild，不扫大事实表。
4. 自然语言进入主链前，必须先被收敛成 `QueryPlan`。
5. `QueryPlan` 只能命中注册过的 `Capability`，再由 `SQL Compiler` 编译成参数化 SQL。
6. AI 只参与：
   - 问题理解补槽
   - 结果解释和建议
   AI 不参与事实计算，也不直接生成生产 SQL。

## Data Layers

### 1. Truth Layer

保留现有权威事实和快照表：

- `fact_consume_bills`
- `fact_recharge_bills`
- `fact_tech_up_clock`
- `fact_tech_market`
- `fact_member_daily_snapshot`
- `fact_member_card_daily_snapshot`
- `fact_tech_daily_snapshot`

这层只回答“真实发生了什么”，不直接服务问答。

### 2. Incremental Derived Layer

夜间批处理中按 `biz_date` / `window_end_biz_date` 增量更新：

- 门店日级指标
- 门店窗口指标
- 顾客画像快照
- 顾客跟进名单排序
- 技师画像窗口
- HQ 门店组合画像

### 3. Serving Layer

P0 只正式支持以下 serving 面：

- `serving_store_day`
- `serving_store_window`
- `serving_customer_profile_asof`
- `serving_customer_ranked_list_asof`
- `serving_tech_profile_window`
- `serving_hq_portfolio_window`
- `serving_manifest`

其中：

- `serving_customer_profile_asof` 是完整顾客画像主表
- `serving_customer_ranked_list_asof` 专门服务“最值得跟进/最该唤回/高价值沉默”等高频名单问题
- `serving_manifest` 记录当前 serving 发布版本，给缓存和查询一致性使用

## Query Plane

### QueryPlan

在线主链统一使用结构化 `QueryPlan`，最小字段包括：

- `entity`
- `scope`
- `time`
- `action`
- `metrics`
- `filters`
- `response_shape`
- `planner_meta`

P0 只支持这些实体：

- `store`
- `customer_profile`
- `tech`
- `hq`

P0 只支持这些动作：

- `summary`
- `ranking`
- `compare`
- `profile`
- `list`

### Capability Registry

Capability Registry 描述“系统当前支持哪些计划”，而不是维护“问题到 SQL”的手工映射表。

P0 先注册：

- 门店日级 summary
- 门店 7/30 天 window summary
- HQ ranking / portfolio
- 顾客画像 profile
- 顾客 ranked list
- 技师画像 window

### SQL Compiler

SQL Compiler 不从 AI 接收 SQL 字符串，只接收 `QueryPlan + Capability`，再编译成参数化 SQL。

P0 只做 5 个 SQL family：

- `summary_by_pk`
- `window_summary`
- `ranking`
- `profile_lookup`
- `ranked_list_lookup`

这样系统维护的是“受控能力集合”，而不是“海量模板 SQL”。

## AI Participation Boundary

AI 参与的部分：

1. 未命中或低置信问句的语义补槽
2. 面向老板/店长的解释性结果文案
3. 建议和动作优先级表达

AI 不参与的部分：

1. 数据入仓
2. 指标计算
3. 快照和派生计算
4. 权限判定
5. SQL 最终生成和执行

## Performance Strategy

当前阶段不做主从，首期性能策略如下：

1. 高频问题优先命中 `serving_*` 面
2. 旧链路保留为 fallback，避免一次性改造造成回归
3. 引入 `plan_hash` 缓存接口
4. 缓存 key 绑定 `serving_version + plan_hash`
5. 所有新主链 SQL 都加：
   - 参数化
   - 维度白名单
   - 窗口白名单
   - statement timeout

## P0 Scope

P0 不做：

- PostgreSQL 主从
- Pinot / ClickHouse
- 自由 AI-SQL
- 任意维度 ad hoc 查询
- 全量重构所有旧 query handlers

P0 要做：

1. 正式引入 `QueryPlan / Capability Registry / SQL Compiler`
2. 新增首批 `serving_*` 面
3. 新主链先覆盖：
   - 门店 summary
   - HQ ranking
   - 顾客画像
   - 顾客名单
   - 技师画像
4. 旧路径继续保留兜底

## Success Criteria

1. 高频标准问题优先走 serving 主链。
2. 白天查询不再依赖全量 rebuild。
3. 顾客画像继续保持 snapshot correctness。
4. 新问题支持从“加 handler”转向“加 capability”。
5. 当前 `10 店` 下实现明显更稳、更快，同时为未来扩容保留清晰路径。
