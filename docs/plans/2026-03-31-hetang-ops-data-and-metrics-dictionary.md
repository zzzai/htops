# Hetang Ops 数据与指标字典

## 1. 目的

本文档只记录“当前项目已经真实落地并可被查询/复盘使用”的数据层、核心字段和指标口径，不写泛化行业理想方案。

判断原则：

- 已进 PostgreSQL 且代码已使用的，写“当前口径”
- 字段已在 `raw_json` 中出现但尚未完成最终映射的，写“待补字段，不下最终判断”
- 未接入的数据，不写成已交付能力

---

## 2. 当前数据分层

### 2.1 归属层

主表：

- `dim_store`

用途：

- 固定维护 `org_id -> canonical store_name`
- 所有事实表、日报、权限都围绕 `org_id`

归属原则：

- `org_id` 是唯一归属主键
- `store_name` 只用于标准展示
- API 原始门店名只保留为审计字段，不参与最终归属判定

### 2.2 原始审计层

主表：

- `raw_api_rows`

用途：

- 保存接口原始返回
- 便于后续字段审计、回放、补口径

### 2.3 事实层

当前主要事实表：

- `fact_members_current`
- `fact_member_cards_current`
- `fact_consume_bills`
- `fact_recharge_bills`
- `fact_user_trades`
- `fact_tech_current`
- `fact_tech_up_clock`
- `fact_tech_market`
- `fact_tech_commission_snapshot`

### 2.4 mart 层

当前主要汇总表：

- `mart_daily_store_metrics`
- `mart_daily_store_alerts`
- `mart_daily_store_reports`

### 2.5 权限与审计层

当前主要权限表：

- `employee_bindings`
- `employee_binding_scopes`
- `command_audits`
- `scheduled_job_runs`

---

## 3. 当前关键字段

### 3.1 `org_id`

来源：

- 配置
- 各事实表

含义：

- 门店唯一归属主键

注意：

- 所有事实归属、权限、日报和 CrewAI 复盘都以它为准

### 3.2 `store_name`

来源：

- `dim_store`

含义：

- 标准门店名

注意：

- 不作为主键
- 可被企微文本查询和 `whoami` 展示使用

### 3.3 `biz_date`

来源：

- 各 `fact_*`
- `mart_*`

含义：

- 营业日

当前口径：

- `05:00` 截止
- `00:00` - `04:59` 归前一营业日

### 3.4 `antiFlag / IsAnti`

来源：

- `fact_consume_bills`
- `fact_recharge_bills`
- `fact_user_trades`

含义：

- 反结 / 冲销标记

当前口径：

- 营收、充值、会员支付、团购等正式指标默认剔除 `antiFlag=true`

### 3.5 `settleId / settleNo`

来源：

- `fact_consume_bills`
- `fact_tech_up_clock`
- `fact_tech_market`

含义：

- 结算单主键 / 单号

用途：

- 订单级串联消费、上钟、推销

### 3.6 `personCode`

来源：

- `fact_tech_up_clock`
- `fact_tech_market`

含义：

- 技师唯一编码

用途：

- 活跃技师数
- 技师人效
- 轮钟 / 点钟 / 加钟结构

### 3.7 `CCode`

来源：

- `fact_consume_bills.raw_json -> CCode`

含义：

- 当前观察到的顾客代码

当前用途：

- 团购客户 cohort
- 团购复到店率
- 团购后会员支付转化率

当前边界：

- 它足够支持消费侧“是否再次到店”“是否后续出现会员支付”的方向性分析
- 但它还没有被正式确认为覆盖完整会员全生命周期的唯一主键
- 因此当前不能把它包装成“团购转储值闭环”

### 3.7A 顾客唯一身份（冻结版）

当前统一口径：

- `member:{member_id}` 为最高优先级稳定身份
- 只有在消费/充值原始记录里的 `referenceCode / CardNo / MemberPhone / Phone / CardId`
  能映射到当前会员或会员卡时，才提升为 `member:{member_id}`
- 若无法映射会员，但存在稳定 `referenceCode / CardNo / CardId`，则使用
  `customer-ref:{normalized_reference}`
- 仅有 `displayName` 而无可映射编码时，记为 `display-name:{normalized_name}`，但视为
  `identity_stable = false`
- 完全无可用身份信息时，回落为 `settle-local:{settle_no|settle_id}`，同样视为
  `identity_stable = false`

当前项目约束：

- `mart_customer_segments`
- `mart_customer_conversion_cohorts`
- `mv_customer_profile_90d`

以上三层都只把 `member:*` 和 `customer-ref:*` 视为稳定经营对象。
`display-name:*` 与 `settle-local:*` 可以用于原始明细解释，但不进入正式顾客经营结论。

### 3.7B 高价值会员定义（冻结版）

当前统一口径：

- 近 90 天到店 `>= 4` 次
- 近 90 天支付 `>= 1000` 元
- 近 90 天发生过会员支付 `> 0`

在此基础上分两类：

- `important-value-member`
  - 满足上述条件
  - 且 `days_since_last_visit <= 30`
- `important-reactivation-member`
  - 满足上述条件
  - 且 `days_since_last_visit > 30`

说明：

- “高价值会员”不是看当前储值余额，也不是看历史累计消费，而是看最近 90 天真实经营表现
- 该定义同时用于顾客分层、技师高价值会员承接、团购首单客转高价值会员判断

### 3.8A 团购开卡 / 储值归因（冻结版）

当前统一口径：

- cohort 锚点为“该顾客历史首个团购订单”
- `7天复到店`
  - 锚点后 7 天内出现任意后续消费订单
- `7天开卡`
  - 锚点后 7 天内满足任一条件：
    - 出现会员支付订单
    - 当前会员 `created_time` 落在锚点后 7 天内
    - 出现充值记录
- `7天储值转化`
  - 锚点后 7 天内出现充值记录
- `30天会员消费转化`
  - 锚点后 30 天内出现会员支付订单

边界说明：

- “开卡”当前是经营归因口径，不等同于 API 明确返回了“办卡成功事件”
- 充值记录优先代表“储值转化”，并可同时算作“开卡/入会承接已发生”
- 团购首单客转高价值会员率，仍按锚点后 30 天内：
  - 到店 `>= 4` 次
  - 支付 `>= 1000` 元
  - 会员支付 `> 0`
  来判断

### 3.8 `Payments`

来源：

- `fact_consume_bills.raw_json -> Payments`
- `fact_recharge_bills.raw_json -> Payments`

当前已用口径：

- `Payments.Name='会员'`：会员支付方向信号
- `Payments.Name in ('美团','抖音','美团团购','抖音团购')`：团购平台信号

### 3.9 `ClockType`

来源：

- `fact_tech_up_clock.raw_json -> ClockType`

当前工作口径：

- `1` = 轮钟
- `2` = 点钟
- `3` = Call 钟
- `4` = M 钟 / Buy 钟

### 3.10 `AddClockType`

来源：

- `fact_tech_up_clock.raw_json -> AddClockType`

当前工作口径：

- `0` = 非加钟
- 非 `0` = 加钟

当前边界：

- 非零子类型的业务含义尚未做官方文档级确认
- 当前只安全判断“是否加钟”，不下更细分结论

### 3.11 `ItemTypeName / ItemCategory / IsDonate`

来源：

- `fact_tech_market.raw_json`

当前用途：

- 项目类型结构
- 赠送结构
- 副项相关方向性判断

当前边界：

- `副项渗透率` 的最终财务级口径仍未完成类目映射
- 只能写成“待补字段，不下最终判断”

---

## 4. 当前 mart 指标口径

以下口径全部对应 `extensions/hetang-ops/src/metrics.ts` 当前实现。

| 指标                              | 当前公式                                                                                          | 来源                                              | 备注                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `serviceRevenue`                  | 当日非反结消费单 `payAmount` 求和                                                                 | `fact_consume_bills`                              | 当前按实付口径，不是理论原价                 |
| `antiServiceRevenue`              | 当日反结消费单 `payAmount` 求和                                                                   | `fact_consume_bills`                              | 用于风险提示                                 |
| `serviceOrderCount`               | 当日非反结消费单数                                                                                | `fact_consume_bills`                              | 当前一单视作一个订单                         |
| `customerCount`                   | 当前等于 `serviceOrderCount`                                                                      | `fact_consume_bills`                              | 还不是去重客数                               |
| `averageTicket`                   | `serviceRevenue / serviceOrderCount`                                                              | mart 计算                                         | 现阶段更接近订单客单价                       |
| `rechargeCash`                    | 当日非反结充值单 `realityAmount` 求和                                                             | `fact_recharge_bills`                             | 现金口径                                     |
| `rechargeStoredValue`             | 当日非反结充值单 `totalAmount` 求和                                                               | `fact_recharge_bills`                             | 含充值总值                                   |
| `rechargeBonusValue`              | 当日非反结充值单 `donateAmount` 求和                                                              | `fact_recharge_bills`                             | 赠送值                                       |
| `storedConsumeAmount`             | 优先取消费 `Payments.Name='会员'` 的支付金额和；若无，则退化为账户流水负向 `changeBalance` 绝对值 | `fact_consume_bills` + `fact_user_trades`         | 当前“会员耗卡”已可分析，但仍保留口径校准空间 |
| `storedConsumeRate`               | `storedConsumeAmount / rechargeCash`                                                              | mart 计算                                         | 当日耗卡 / 当日充值的方向性健康指标          |
| `groupbuyOrderCount`              | 非反结消费单中，存在团购支付的订单数                                                              | `fact_consume_bills.raw_json`                     | 团购支付识别依赖 `Payments`                  |
| `groupbuyAmount`                  | 非反结消费单中的团购支付金额总和                                                                  | `fact_consume_bills.raw_json`                     | 可拆到平台                                   |
| `groupbuyOrderShare`              | `groupbuyOrderCount / serviceOrderCount`                                                          | mart 计算                                         | 团购订单占比                                 |
| `groupbuyAmountShare`             | `groupbuyAmount / serviceRevenue`                                                                 | mart 计算                                         | 团购金额占比                                 |
| `groupbuyPlatformBreakdown`       | 按 `美团 / 抖音` 聚合的订单数与金额                                                               | `fact_consume_bills.raw_json`                     | 当前已接入                                   |
| `groupbuyRevisitRate`             | 近 30 天 lookback 内，首单团购顾客后续再次消费比例                                                | `fact_consume_bills.raw_json -> CCode`            | 是“复到店率”，不是会员闭环                   |
| `groupbuyMemberPayConversionRate` | 近 30 天 lookback 内，首单团购顾客后续出现“会员支付”的比例                                        | `fact_consume_bills.raw_json -> CCode / Payments` | 当前正确名称是“团购后会员支付转化率”         |
| `totalClockCount`                 | 当日上钟 `count` 求和                                                                             | `fact_tech_up_clock`                              | 含钟数                                       |
| `clockRevenue`                    | 当日上钟 `turnover` 求和                                                                          | `fact_tech_up_clock`                              | 技师上钟产值                                 |
| `clockEffect`                     | `serviceRevenue / totalClockCount`                                                                | mart 计算                                         | 当前钟效主指标                               |
| `activeTechCount`                 | 当日有上钟记录的 `personCode` 去重数                                                              | `fact_tech_up_clock`                              | 活跃技师                                     |
| `onDutyTechCount`                 | 当前技师快照中 `isJob=true and isWork=true` 的人数                                                | `fact_tech_current`                               | 在岗技师                                     |
| `techCommission`                  | 当日上钟 `comm` 求和                                                                              | `fact_tech_up_clock`                              | 技师提成                                     |
| `techCommissionRate`              | `techCommission / clockRevenue`，若 `clockRevenue<=0` 则退化为 `/serviceRevenue`                  | mart 计算                                         | 当前成本警戒指标                             |
| `marketRevenue`                   | 当日推销 `afterDisc` 求和                                                                         | `fact_tech_market`                                | 推销实收                                     |
| `marketCommission`                | 当日推销 `commission` 求和                                                                        | `fact_tech_market`                                | 推销提成                                     |
| `effectiveMembers`                | 当前会员中 `silentDays < 180` 的人数                                                              | `fact_members_current`                            | 有效会员池                                   |
| `newMembers`                      | 当前会员中 `createdTime` 对应营业日等于当天的数量                                                 | `fact_members_current`                            | 按营业日算新增                               |
| `sleepingMembers`                 | 当前会员中 `silentDays >= 90` 的人数                                                              | `fact_members_current`                            | 沉默会员                                     |
| `sleepingMemberRate`              | `sleepingMembers / effectiveMembers`                                                              | mart 计算                                         | 沉默率                                       |
| `currentStoredBalance`            | 当前会员 `storedAmount` 总和                                                                      | `fact_members_current`                            | 当前储值余额                                 |
| `roomOccupancyRate`               | `totalClockCount / (roomCount * operatingHoursPerDay)`                                            | store config + mart                               | 仅在门店配置补齐时可算                       |
| `roomTurnoverRate`                | `serviceOrderCount / roomCount`                                                                   | store config + mart                               | 仅在门店配置补齐时可算                       |
| `grossMarginRate`                 | `(serviceRevenue - techCommission - 其他变动成本) / serviceRevenue`                               | mart + config                                     | 依赖成本配置                                 |
| `netMarginRate`                   | `(serviceRevenue - techCommission - 其他变动成本 - fixedMonthlyCost/30) / serviceRevenue`         | mart + config                                     | 依赖成本配置                                 |
| `breakEvenRevenue`                | `fixedMonthlyCost / grossMarginRate`                                                              | mart + config                                     | 依赖成本配置                                 |

---

## 5. 当前报警口径

当前默认阈值来自配置：

| 告警             | 默认阈值 |
| ---------------- | -------- |
| 营收环比下滑     | `20%`    |
| 钟数环比下滑     | `20%`    |
| 反结比异常       | `10%`    |
| 活跃技师过少     | `< 1`    |
| 储值耗卡率偏低   | `< 80%`  |
| 沉默会员率过高   | `> 20%`  |
| 技师提成占比过高 | `> 45%`  |
| 团购占比高       | `> 40%`  |

这些阈值已经可用于日报和 CrewAI 单店复盘，但还不是总部治理版的最终标准。

---

## 6. 当前不可直接下结论的指标

以下字段或指标虽然已经在原始数据中出现，但当前仍不能被当作最终经营结论：

- `副项渗透率`
- `CAC`
- `活动 ROI`
- 完整的“办卡/充值归因闭环”
- 最终财务级项目毛利
- 以唯一会员主键贯穿的全链路团购转化闭环

统一表达方式：

- 字段已存在，但映射或口径仍在完善
- 可做方向性分析
- 不下财务级或经营考核级最终判断

---

## 7. 给 OpenClaw / CrewAI 的口径约束

当前提示词和问答系统必须遵守：

1. 永远优先按 `org_id` 归属
2. 永远优先按营业日 `biz_date` 解释数据
3. `CCode` 只能安全用于顾客复到店和会员支付方向判断
4. 不再使用“团购转储值”表述，统一用“团购后会员支付转化率”
5. `ItemCategory / ItemTypeName / IsDonate` 已可辅助判断结构，但不能冒充最终副项 KPI

---

## 8. 参考文档

更细的原始字段清单见：

- `docs/plans/2026-03-31-hetang-api-field-audit.md`
- `docs/plans/2026-03-31-hetang-api-field-audit-and-prompt-upgrade.md`
