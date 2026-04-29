# Reactivation Next-Stage Algorithms

**Goal:** 在现有顾客画像、召回特征和本地 PostgreSQL 数仓之上，补齐下一阶段最值得落地的召回算法，并以日级策略表形式稳定产出，直接服务 15:00 召回推送与后续开放式问答。

**Architecture:** 继续沿用 `fact -> mart -> serving`。先保留既有 `mart_member_reactivation_features_daily` 作为特征底座，再新增 `mart_member_reactivation_strategies_daily`，把“流失风险、回店窗口、触达窗口、生命周期动量、总优先级”统一固化成一张表。召回推送优先使用策略分，缺失时回退到旧的 `reactivationPriorityScore`。

**Tech Stack:** Node.js, TypeScript, PostgreSQL, pg-mem, Vitest

---

## 实施顺序

| 顺序 | 算法 | 现状数据是否足够 | 当前实现状态 |
|---|---|---|---|
| 1 | 流失风险评分 | 是 | 已实现 |
| 2 | 回店窗口判断 | 是 | 已实现 |
| 3 | 触达窗口判断 | 是 | 已实现 |
| 4 | 生命周期动量判断 | 是 | 已实现 |
| 5 | 策略总优先级 | 是 | 已实现 |

## 输入字段

统一来自 `mart_member_reactivation_features_daily`：

| 字段 | 用途 |
|---|---|
| `primary_segment` | 业务主客群基准 |
| `days_since_last_visit` | 沉默程度 |
| `visit_count_30d`, `visit_count_90d` | 最近活跃动量 |
| `pay_amount_30d`, `pay_amount_90d` | 最近消费动量 |
| `current_stored_balance_inferred` | 当前储值余额 |
| `stored_balance_delta_30d` | 最近 30 天储值变化 |
| `depletion_velocity_30d` | 最近 30 天余额消耗速度 |
| `projected_balance_days_left` | 当前余额预计还能支撑多久 |
| `average_visit_gap_days_90d` | 个人历史回店周期 |
| `cycle_deviation_score` | 当前是否已超过个人回店节奏 |
| `dominant_visit_weekday` | 偏好周几 |
| `dominant_visit_daypart` | 偏好时段 |
| `dominant_visit_month_phase` | 偏好月内阶段 |
| `preferred_daypart_share_90d` | 时段偏好强度 |
| `time_preference_confidence_score` | 时间偏好置信度 |
| `reactivation_priority_score` | 旧版召回综合分 |

## 标签定义

### 1. 流失风险

| 标签 | 含义 |
|---|---|
| `critical` | 已处于强流失或强超期状态，必须优先人工召回 |
| `high` | 流失风险显著，建议本周优先处理 |
| `medium` | 有明显转冷信号，但不一定要当天处理 |
| `low` | 当前更适合维护或观察 |

### 2. 回店窗口

| 标签 | 含义 |
|---|---|
| `due-now` | 已到个人最佳回店点，今天就该跟 |
| `due-this-week` | 本周是高概率回店窗口 |
| `later-this-month` | 本月内仍有机会，但不必当天打 |
| `not-due` | 还没到自然回店窗口 |

### 3. 触达窗口

| 标签 | 含义 |
|---|---|
| `best-today` | 今天就是偏好触达日 |
| `best-this-week` | 今天日期合适，但更偏向本周内某个时段 |
| `wait-preferred-weekday` | 建议等到偏好周几再触达 |
| `low-confidence` | 时间偏好样本太弱，先别过拟合 |

### 4. 生命周期动量

| 标签 | 含义 |
|---|---|
| `accelerating` | 最近 30 天明显升温 |
| `stable` | 基本平稳 |
| `cooling` | 已在降温 |
| `stalled` | 最近活跃基本停住 |

### 5. 推荐动作

| 标签 | 含义 |
|---|---|
| `immediate-1to1` | 今天直接 1 对 1 回访 |
| `scheduled-reactivation` | 排进本周召回计划 |
| `growth-nurture` | 重点做成长转化，不是强唤回 |
| `observe` | 先观察，不急于打扰 |

## 产出表设计

表名：`mart_member_reactivation_strategies_daily`

| 字段 | 说明 |
|---|---|
| `org_id`, `biz_date`, `member_id` | 主键 |
| `customer_identity_key`, `customer_display_name` | 会员识别 |
| `primary_segment` | 主客群 |
| `reactivation_priority_score` | 旧版召回分 |
| `churn_risk_score`, `churn_risk_label` | 流失风险 |
| `revisit_probability_7d`, `revisit_window_label` | 回店窗口 |
| `recommended_touch_weekday`, `recommended_touch_daypart` | 推荐触达时间 |
| `touch_window_match_score`, `touch_window_label` | 触达匹配度 |
| `lifecycle_momentum_score`, `lifecycle_momentum_label` | 生命周期动量 |
| `recommended_action_label` | 推荐动作 |
| `strategy_priority_score` | 新版总优先级 |
| `strategy_json` | 可扩展解释字段 |
| `updated_at` | 更新时间 |

## 接入点

| 模块 | 接入方式 |
|---|---|
| `rebuild-customer-history-local.ts` | 重建完成特征表后继续重建策略表 |
| `backfill-customer-history.ts` | 历史补数后同步重建策略表 |
| `runtime.ts` | 本地历史 catchup 同步重建策略表 |
| `send-reactivation-picks.ts` | 15 点推送优先读取策略表排序 |
| `reactivation-push.ts` | 候选排序优先用 `strategy_priority_score` |
