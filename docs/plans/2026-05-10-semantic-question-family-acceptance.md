# 高频经营问题语义验收目录

日期：2026-05-10
状态：P0 acceptance view
机器真相源：`src/semantic-operating-contract.json`

## 1. 目的

这份文档不是第二套口径，作用是把机器可读 contract 翻成业务和交付都能看懂的验收目录。

当前语义验收口径：

- question families：26 个
- natural questions：150 个
- metric contracts：25 个
- segment contracts：9 个
- analysis recipes：23 个
- answer templates：26 个
- proactive diagnoses：17 个

验收原则：

- 经营数据问题必须落到 capability / metric / segment / recipe。
- 暂不支持的问题必须标注 `capability_gap`、`data_gap_realtime` 或 `data_gap_model`。
- 知识检索层只解释规则、SOP、口径和边界，不承载订单、充值、排班等流水事实。

## 2. Question Family -> Capability -> Recipe 对照表

| 角色 | question family | 问题数 | 当前 capability | 主要 metric / segment / recipe | 状态 |
|---|---:|---:|---|---|---|
| boss | 今日营收 | 5 | `store_metric_summary_v1` | 今日进账/实收；今日折扣/反结流出 | implemented |
| boss | 周期对比 | 6 | `store_compare_v1`, `store_trend_v1` | 本周 vs 上周经营对比；本月 vs 上月趋势拆解 | implemented |
| boss | 充值健康 | 5 | `store_metric_summary_v1` | 充值本金/实充；充值总额；充值赠送金额；充值健康诊断 | implemented |
| boss | 钱趴在卡里 | 5 | `store_metric_summary_v1`, `customer_segment_list_v1` | 当前储值余额；高余额沉默会员；会员流失/回流诊断 | implemented |
| boss | 会员流失 | 5 | `customer_segment_list_v1`, `customer_ranked_list_lookup_v1` | 沉默会员；会员流失/回流诊断 | implemented |
| boss | 技师产出 | 7 | `tech_leaderboard_ranking_v1` | 技师营收；技师钟效；赚钱能力公平比较；副项收入 | implemented / capability_gap |
| boss | 风险异常 | 5 | `store_anomaly_v1`, `store_risk_v1` | 异常反结金额；反结/退款异常诊断；门店健康复盘 | implemented |
| boss | 渠道与增长 | 6 | `store_metric_summary_v1` | 团购复到店率；团购转会员诊断；副项承接诊断 | implemented / capability_gap |
| boss | 综合经营判断 | 6 | `store_report_v1`, `store_review_async_v1` | 门店整体经营健康复盘 | implemented |
| manager | 当前实时状态 | 6 | `tech_current_runtime_v1` | 实时楼面状态；等位；待结账 | implemented / data_gap_realtime |
| manager | 今日汇总数据 | 7 | `store_metric_summary_v1` | 今日实收；到店人数；总钟数；加钟率 | implemented |
| manager | 技师今日动态 | 7 | `tech_leaderboard_ranking_v1`, `tech_profile_lookup_v1` | 技师营收；总钟数；单技师日内表现 | implemented |
| manager | 副项推销 | 5 | `store_market_breakdown_v1`, `tech_leaderboard_ranking_v1` | 副项收入；副项承接诊断；高钟数零副项样本 | implemented / capability_gap |
| manager | 客人情况 | 7 | `store_metric_summary_v1`, `store_anomaly_v1` | 新客数；首访新客；退款/反结客情 | implemented |
| manager | 排班与安排 | 5 | none | 班次人手与承接容量 | data_gap_realtime |
| manager | 业绩进度追踪 | 8 | `store_report_v1`, `store_metric_summary_v1` | 今日目标进度；今日实收；到店人数；总钟数 | data_gap_model / implemented |
| manager | 具体查人查单 | 5 | `tech_profile_lookup_v1`, `store_metric_summary_v1` | 单技师表现；点钟率；加钟率 | implemented |
| crm | 会员沉默分层 | 6 | `customer_segment_list_v1` | 沉默会员；有余额但不来的会员 | implemented |
| crm | 今日触达任务 | 5 | `customer_ranked_list_lookup_v1`, `birthday_member_list_v1` | 高价值会员；今日跟进任务；生日窗口触达 | implemented |
| crm | 点钟黏性与风险 | 6 | `customer_relation_lookup_v1` | 单技师忠诚客；技师依赖和离职风险 | implemented |
| crm | 优惠券效果 | 5 | `member_marketing_analysis_v1` | 领券未核销客；优惠券核销效果 | implemented |
| crm | 充值行为分析 | 5 | `customer_segment_list_v1` | 充值未到店会员；充值后激活；高价值会员 | implemented |
| crm | 团购客转化 | 5 | `store_metric_summary_v1` | 团购复到店率；团购回头客户；团购转会员诊断 | implemented |
| crm | 新客跟进 | 5 | `customer_segment_list_v1` | 首访新客；首访到二访转化 | implemented |
| crm | 技师与客人关系 | 6 | `customer_relation_lookup_v1` | 技师依赖和离职风险 | implemented |
| crm | 会员洞察与画像 | 7 | `customer_profile_lookup_v1`, `arrival_profile_timeseries_v1` | 高价值会员；顾客画像；到店时段偏好 | implemented |

## 3. 主动发现型问题

这些问题不应该等人问才回答，要进入日报、doctor、admin summary 或动作队列。

| 痛点 | 主动发现目标 | 主要 contract | 交付面 |
|---|---|---|---|
| 营收下滑 | 营收下降但客流未明显下降时，提示客单价或项目结构问题 | `metric:daily_cash_in`, `analysis:store_health_review` | 5店日报 pain radar |
| 客流下滑 | 到店人数下降但供给正常时，提示获客或老客回访问题 | `metric:customer_count`, `analysis:store_health_review` | 5店日报 pain radar |
| 充值变弱 | 消费正常但充值下滑时，提示续费意愿变弱 | `metric:recharge_cash`, `analysis:recharge_health_review` | 日报 + 店长动作 |
| 储值压力 | 高余额会员长期不来时，提示沉睡资金和负债压力 | `metric:stored_balance`, `segment:high_balance_silent_customer` | 日报 + reactivation queue |
| 新客浪费 | 团购/新客 7/30 天无二访时，提示拉新成本浪费 | `analysis:groupbuy_conversion_review`, `analysis:first_visit_conversion_review` | 日报 + 店长动作 |
| 技师依赖 | 单技师绑定大量高余额客户时，提示离职和排班风险 | `segment:tech_loyal_customer`, `analysis:tech_dependency_risk_review` | 日报 + customer relation review |
| 技师产能异常 | 上钟多但副项/加钟低时，提示服务转化弱 | `metric:add_clock_rate`, `metric:market_revenue` | 日报 + 店长动作 |
| 点钟率异常 | 点钟率突然下降时，提示口碑、推荐或排班问题 | `metric:point_clock_rate`, `analysis:tech_daily_state_review` | 日报 + 店长动作 |
| 出勤异常 | 在册够但日均出勤低时，提示排班稳定性问题 | `metric:attendance_rate`, `analysis:shift_capacity_review` | 日报 + 店长动作 |
| 反结异常 | 反结金额或次数突增时，提示财务和管理风险 | `metric:anti_settle_amount`, `analysis:anti_settle_anomaly_review` | 日报 + doctor/admin |
| 折扣异常 | 实收与标价差距扩大时，提示优惠失控 | `metric:daily_discount_given`, `analysis:store_health_review` | 日报 + 店长动作 |
| 数据风险 | 接口缺口影响回答或日报时，提示可信度风险 | `analysis:data_coverage_review` | 日报 + doctor/admin |

## 4. 当前明确边界

暂不硬答：

- 门店运营成本、利润、可分配现金利润：缺成本模型。
- 等位、待结账、完整排班明细：缺实时事实源。
- 外部竞品深度研究：需要外部研究 lane，不进入经营事实库。
- 未同步完整历史数据的问题：必须先通过 data coverage gate。

可以解释但不能当经营事实：

- SOP、制度、会员规则、退款规则、指标口径解释。
- 外部环境弱信号，如天气、节假日、商圈、POI、人口。

## 5. 验收命令

```bash
npx vitest run src/semantic-operating-contract.test.ts src/route-eval.test.ts
```

通过标准：

- 至少 100 个高频问题绑定 answer template。
- route eval 不把 HQ 风险问法误路由成普通模板。
- 不支持能力必须以 gap 形式注册，而不是假装可答。
