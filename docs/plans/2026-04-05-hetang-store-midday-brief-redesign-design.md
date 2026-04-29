# Hetang Store Midday Brief Redesign Design

## Goal

将当前“字段摘要式”店长午报，重构成面向门店管理动作的五段式经营简报。

## Why

当前午报存在两个核心问题：

1. 直接展示 `memberRepurchaseRate7d`、`storedBalanceLifeMonths`、`renewalPressureIndex30d` 等字段时，经常出现 `N/A`，会损伤店长对报表的信任。
2. 结构更像技术字段摘要，而不是“看完就知道今天先抓什么”的店长经营简报。

## Approved Structure

店长版午报统一改成 5 段：

1. `一句话判断`
2. `昨日收盘`
3. `近7天变化`
4. `近30天会员与储值风险`
5. `今日先抓`

## Data Sources

### 昨日收盘

来源：`DailyStoreReport.metrics`

字段：

- `serviceRevenue`
- `serviceOrderCount`
- `totalClockCount`
- `clockEffect`
- `pointClockRate`
- `addClockRate`

### 近7天变化

来源：`mv_store_review_7d`

当前窗口：`window_end_biz_date = bizDate`
对比窗口：`window_end_biz_date = bizDate - 7`

字段：

- `revenue7d`
- `groupbuy7dRevisitRate`
- `groupbuy7dStoredValueConversionRate`
- `addClockRate7d`

### 近30天会员与储值风险

来源：`mv_store_summary_30d`

当前窗口：`window_end_biz_date = bizDate`
对比窗口：`window_end_biz_date = bizDate - 30`

字段：

- `memberRepurchaseRate7d`
- `sleepingMemberRate`
- `rechargeCash30d`
- `storedConsumeAmount30d`
- `renewalPressureIndex30d`
- `currentStoredBalance`

## Hard Rules

1. 店长版午报不允许出现 `N/A`
2. 没有可靠值时，不展示该指标
3. 某一段缺少足够可靠值时，整段隐藏
4. 文案中不再使用 `现金池`
5. 今日动作只给 `1-3` 条，必须能直接执行

## Judgment Logic

一句话判断按经营优先级输出：

1. `储值承压`
2. `老客变冷`
3. `承接偏弱`
4. `盘子稳`

可组合，但避免冗长。

## Delivery Strategy

1. 保留现有 `03:00` 营业日口径
2. 不修改长日报缓存结构
3. 在 `sendMiddayBrief()` 时补取 7 天与 30 天稳定面
4. 若稳定面缺失或线上视图未建好，午报自动降级成“昨日收盘 + 今日先抓”
