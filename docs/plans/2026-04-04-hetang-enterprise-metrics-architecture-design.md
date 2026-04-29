# Hetang Enterprise Metrics Architecture Design

## Goal

把 `hetang-ops` 从“能回答一些门店问题”的插件，推进成“口径统一、查询稳定、复盘可追溯”的企业级经营分析底座。

## Context

当前项目已经具备不错的基础能力：

- `OpenClaw + hetang-ops` 承接企微消息、命令入口、异步任务调度
- PostgreSQL 已落地事实表、`mart_*` 层、日报层、异步分析任务表
- `mv_store_manager_daily_kpi` 已经进入自然语言快查路径
- `CrewAI sidecar` 已经接入深度复盘链路，但目前更适合作为解释层，而不是核心计算层

当前真正的短板不是“没有 Agent”，而是：

- 指标口径仍有隐式实现，复用和审计成本高
- 技师画像、顾客画像、转化漏斗还缺少稳定的查询层
- 一部分能力仍依赖运行时临算或 `metrics_json`，导致解释成本偏高

## Problem Statement

如果不先把经营指标、画像指标、转化链路沉淀成稳定数据层，后续无论是加 Redis、Cube.js、语义缓存还是更多 Agent，本质上都会变成“把不够稳定的结果更快地发出去”。

所以第一原则应当是：

- 让数据库和代码做确定性计算
- 让 LLM 负责理解问题、组织表达、解释原因和提出建议

## Options

### Option A: 保持现状，继续在 TypeScript 运行时里临时聚合

优点：

- 迭代快
- 不需要额外建表或视图

缺点：

- 高价值指标容易分散在多个查询逻辑里
- 技师画像、顾客画像和转化漏斗的口径难以统一复用
- 后续主动预警、周报、总部对比都要重复拼装

### Option B: 先建设项目内“轻量指标中台”，逐步补齐物化视图和明细层

优点：

- 保持当前技术栈，成本最低
- 先把最常用、最重要的经营口径收敛到 PostgreSQL 层
- 为后续周报、风控评分、Agent 解释层提供稳定输入

缺点：

- 需要先整理口径字典和建设顺序
- 一部分 `metrics_json` 字段要逐步迁移到显式列

### Option C: 立即引入完整 Headless BI 和语义缓存架构

优点：

- 长远架构更完整
- 对大规模企业化扩展更友好

缺点：

- 当前阶段投入过大
- 很容易在口径尚未冻结时过早抽象
- 会把真正的问题从“指标定义”伪装成“工具选型”

## Recommendation

选择 Option B。

这最符合当前项目阶段，也最符合门店经营系统的现实：先把数算准、链路跑稳、画像可追溯，再谈更重的基础设施升级。

## Design

### 1. 先冻结经营口径，再升级数据层

先冻结以下口径：

- 门店大盘：日实收、日耗卡、日单数、点钟率、加钟率、钟效、客单价
- 会员转化：7 天复到店率、7 天开卡率、7 天储值转化率、30 天会员消费转化率、团购首单客转高价值会员率
- 技师画像：近 30 天总钟数、点钟率、加钟率、业绩、提成、服务顾客数、服务单数
- 顾客画像：近 30/90 天消费次数、消费金额、价值等级、偏好技师、偏好项目、茶水餐食偏好

这些口径一旦冻结，查询层和 AI 层才能统一。

### 2. 建立三类核心数据承载层

#### 2.1 快查宽表

继续强化 `mv_store_manager_daily_kpi`，让它成为店长单日快查主宽表。

#### 2.2 画像宽表

新增：

- `mv_tech_profile_30d`
- `mv_customer_profile_90d`

这两张视图对应技师和顾客两个核心经营对象，优先级极高。

#### 2.3 转化明细层

新增：

- `mart_customer_conversion_cohorts`

因为所有“转化率”如果没有顾客级 cohort 明细做底座，都只能得到一个总数，无法解释和追责。

The exact fields and aggregations required for the P0 views are captured in the companion contract document (`docs/plans/2026-04-04-hetang-p0-sql-contract.md`). Please refer to that contract when reviewing SQL and accessor changes.

### 3. 明确 JSON 层和显式列层的边界

以下内容优先保留在 `mart_daily_store_metrics.metrics_json`：

- 日报文案
- 风险解释
- 数据质量提示
- 暂时不稳定的辅助分析字段

以下内容应逐步迁移到显式列 / 视图：

- 核心经营指标
- 技师画像核心字段
- 顾客画像核心字段
- 风险评分字段

### 4. 调整 AI 层职责

`CrewAI sidecar` 和后续 LLM 只消费结构化上下文，不负责定义业务口径。

推荐分工：

- 数据层：计算指标、画像、漏斗、风险
- TypeScript 主链路：取数、路由、调度、回传
- LLM/CrewAI：解释、归因、建议、润色

### 5. 建设顺序

P0：

- 强化 `mv_store_manager_daily_kpi`
- 新建 `mv_tech_profile_30d`
- 新建 `mv_store_review_7d`

P1：

- 新建 `mart_customer_conversion_cohorts`
- 新建 `mv_customer_profile_90d`

P2：

- 新建 `mv_store_risk_score_7d`
- 新建 `mv_store_summary_30d`
- 新建 `mart_customer_preference_profile`

## Risks

- 顾客身份识别规则如果不统一，会直接污染技师画像和转化率
- 原始 `raw_json` 中茶水、餐食、加钟等字段如果提取不稳定，会影响画像可信度
- 如果在口径未冻结前引入更重的 BI / 缓存架构，会放大治理成本

## Success Criteria

- 高频快查问题不再依赖运行时临场拼装
- 技师画像能稳定回答“近 30 天服务了多少顾客”
- 顾客画像能稳定输出价值等级、技师偏好和消费结构
- 转化率问题可以追溯到顾客级 cohort 明细
- AI 输出的经营建议基于统一口径，而非提示词临场解释
