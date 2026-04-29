# Semantic Operating Contract

日期：2026-04-29  
状态：implemented seed contract

## 1. 这份资产解决什么问题

这次不是“补知识库”，而是把三类原本散落的语义资产收成正式 contract：

1. `150_natural_questions` 的真实人话问法
2. “人话 -> 字段 / 逻辑”的经营口径
3. “AI 应该主动发现什么”的主动诊断清单

正式落点：

- 机器可读 contract: `src/semantic-operating-contract.json`
- Typed accessors / bounded knowledge search: `src/semantic-operating-contract.ts`
- Bounded meta tool: `search_operating_knowledge`

## 2. Question Family 总表

### 2.1 老板

| family | 当前主 capability | recipe 主轴 | 状态 |
| --- | --- | --- | --- |
| 今日营收 | `store_metric_summary_v1` | `metric:daily_cash_in` | implemented |
| 周期对比 | `store_compare_v1` / `store_trend_v1` | `analysis:week_vs_last_week_store` | implemented |
| 充值健康 | `store_metric_summary_v1` | `metric:recharge_cash` | implemented |
| 钱趴在卡里 | `store_metric_summary_v1` / `customer_segment_list_v1` | `segment:high_balance_silent_customer` | implemented |
| 会员流失 | `customer_segment_list_v1` | `analysis:member_churn_review` | implemented |
| 技师产出 | `tech_leaderboard_ranking_v1` | `analysis:tech_earnings_fairness_review` | partial |
| 风险异常 | `store_anomaly_v1` / `store_risk_v1` | `analysis:anti_settle_anomaly_review` | implemented |
| 渠道与增长 | `store_metric_summary_v1` | `analysis:groupbuy_conversion_review` | partial |
| 综合经营判断 | `store_report_v1` / `store_review_async_v1` | `analysis:store_health_review` | implemented |

### 2.2 店长

| family | 当前主 capability | recipe 主轴 | 状态 |
| --- | --- | --- | --- |
| 当前实时状态 | `tech_current_runtime_v1` | `analysis:realtime_floor_state` | partial |
| 今日汇总数据 | `store_metric_summary_v1` | `metric:daily_cash_in` | implemented |
| 技师今日动态 | `tech_leaderboard_ranking_v1` / `tech_profile_lookup_v1` | `analysis:tech_daily_state_review` | implemented |
| 副项推销 | `store_market_breakdown_v1` / `tech_leaderboard_ranking_v1` | `analysis:market_attach_review` | partial |
| 客人情况 | `store_metric_summary_v1` / `store_anomaly_v1` | `segment:first_visit_new_customer` | partial |
| 排班与安排 | - | `analysis:shift_capacity_review` | realtime gap |
| 业绩进度追踪 | `store_metric_summary_v1` / `store_report_v1` | `analysis:daily_target_progress_review` | partial |
| 具体查人查单 | `tech_profile_lookup_v1` | `metric:point_clock_rate` | implemented |

### 2.3 运营 / 会员专员

| family | 当前主 capability | recipe 主轴 | 状态 |
| --- | --- | --- | --- |
| 会员沉默分层 | `customer_segment_list_v1` | `segment:sleeping_customer` | implemented |
| 今日触达任务 | `customer_ranked_list_lookup_v1` / `birthday_member_list_v1` | `analysis:customer_followup_task_review` | implemented |
| 点钟黏性与风险 | `customer_relation_lookup_v1` | `analysis:tech_dependency_risk_review` | implemented |
| 优惠券效果 | `member_marketing_analysis_v1` | `analysis:coupon_redemption_review` | implemented |
| 充值行为分析 | `customer_segment_list_v1` | `segment:recharge_not_visited_member` | implemented |
| 团购客转化 | `store_metric_summary_v1` | `analysis:groupbuy_conversion_review` | implemented |
| 新客跟进 | `customer_segment_list_v1` | `analysis:first_visit_conversion_review` | implemented |
| 技师与客人关系 | `customer_relation_lookup_v1` | `analysis:tech_dependency_risk_review` | implemented |
| 会员洞察与画像 | `customer_profile_lookup_v1` / `arrival_profile_timeseries_v1` | `analysis:customer_profile_review` | implemented |

## 3. 高频经营口径 contract

当前 contract 已把高频经营口径收成三类机器资产：

### 3.1 Metric contracts

首批已经正式收口：

- `metric:daily_cash_in`
- `metric:daily_discount_given`
- `metric:recharge_cash`
- `metric:recharge_total_with_bonus`
- `metric:recharge_bonus_value`
- `metric:stored_balance`
- `metric:tech_service_revenue`
- `metric:tech_clock_efficiency`
- `metric:point_clock_rate`
- `metric:add_clock_rate`
- `metric:new_member_count`
- `metric:groupbuy_revisit_rate`
- `metric:anti_settle_amount`

每条 contract 都包含：

- 当前 `metric_key`
- 当前 `capability_id`
- 上游 API 编号
- 上游字段路径
- 本地 truth surface
- calculation logic
- human definition

### 3.2 Segment contracts

首批已经正式收口：

- `segment:sleeping_customer`
- `segment:silent_member_with_balance`
- `segment:high_balance_silent_customer`
- `segment:high_value_member`
- `segment:groupbuy_revisit_customer`
- `segment:tech_loyal_customer`
- `segment:first_visit_new_customer`
- `segment:coupon_received_unused_customer`

已补上：

- `segment:recharge_not_visited_member`

### 3.3 Analysis recipes

这次把“不是简单查数，而是要拆解”的问法也正式收口了，包括：

- 周环比 / 月环比
- 充值健康
- 会员流失
- 技师赚钱能力公平比较
- 反结异常
- 团购转化
- 门店整体健康复盘
- 今日目标进度
- 新客首访到二访
- 技师依赖风险

## 4. 主动发现 contract

这次没有再起一条新 runtime，而是先把主动发现收成 bounded contract，并挂到现有 schedule / capability 面上：

| diagnosis | mode | hook / capability | 用途 |
| --- | --- | --- | --- |
| `scheduled-high-balance-silent-members` | scheduled | `send-reactivation-push` | 高余额沉默会员预警 |
| `scheduled-recharge-consume-divergence` | scheduled | `build-report` | 充值下滑但消费未掉的背离解释 |
| `scheduled-anti-settle-watch` | scheduled | `audit-daily-report-window` | 反结/退款异常巡检 |
| `interactive-tech-dependency-risk` | interactive | `customer_relation_lookup_v1` | 需要时直接问技师依赖风险 |
| `planned-high-clock-zero-attach` | scheduled | `build-report` | 高钟数零副项样本，当前仍是 gap |

也就是说，主动发现现在有了正式 contract，但没有把 `runtime.ts` 再膨胀成新总控。

## 5. 知识检索边界

这次补的不是“经营数据知识库”，而是一个边界清楚的 knowledge registry：

允许进入知识层的 domain：

- `metric_definition`
- `report_scope_definition`
- `store_sop`
- `service_sop`
- `membership_policy`
- `refund_rule`
- `coupon_rule`
- `training_manual`
- `policy_rule`

明确禁止的 fact class：

- `transaction_facts`
- `member_raw_detail`
- `tech_payroll_detail`
- `realtime_floor_state`
- `report_cache_rows`

当前 meta tool surface：

- `explain_metric_definition`
- `search_operating_knowledge`

这层只回答：

- 规则是什么
- SOP 怎么做
- 报表/指标口径是什么

不回答：

- 昨天真实发生了多少
- 哪个会员明细怎么样
- 哪个技师流水是多少

当前仍保留的实时边界：

- `现在有客人在等位吗`
- `后台有几张待结账的单`

这两类问法现在会给出**明确边界回复**，不会再掉回泛化未识别；
但它们还没有稳定实时事实源，所以不能伪装成已支持的严肃查询。

## 6. 这次交付的价值

这次真正补的是四个“中间层真相”：

1. `人话问题家族`
2. `经营口径 contract`
3. `主动发现 contract`
4. `知识边界 contract`

所以后面继续推进时，应该优先做：

1. 把 `partial / gap` family 按 owner module 继续转成 capability
2. 把主动诊断逐步接入日报 / doctor / admin read
3. 往 knowledge registry 里补真正的规则 / SOP / 口径文档

不该做的是把经营流水整体向量化，或者让模型越过 capability graph 直接查底表。
