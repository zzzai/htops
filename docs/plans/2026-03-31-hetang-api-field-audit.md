# Hetang API Field Audit

## Purpose

This audit is grounded in two things:

- observed raw keys from `raw_api_rows` samples for endpoints `1.1` through `1.8`
- the current normalized contracts in `extensions/hetang-ops/src/types.ts` and `extensions/hetang-ops/src/normalize.ts`

The goal is to distinguish:

- fields already normalized and safe for marts/prompts
- fields already present in raw payloads but not yet lifted into first-class columns
- fields that still need official doc semantics before we should hard-code business meaning

## Current Headline

- `团购` is already present in raw `1.2` consume payloads through `Payments[].Name`
- `加钟` is already present in raw `1.6` up-clock payloads through `AddClockType` and related fields
- `副项/项目类型` is already present in raw `1.7` market payloads through `ItemTypeName`, `ItemCategory`, and `IsDonate`
- current marts still underuse these fields because the normalized layer keeps many of them only inside `raw_json`

## Working Semantic Mapping

These are **working semantics inferred from live payloads, current marts, and shop-floor business logic**. They are safe enough for prompt guidance and directional analysis, but should still be validated against official docs before being promoted into finance-grade KPI definitions.

### 1.2 Payments

- `Payments[].Name = 会员` can already be used as a real member-payment / stored-value consumption direction signal
- `Payments[].Name in {美团, 抖音, 美团团购, 抖音团购}` can already be used as a real group-buy platform signal
- `Payments[].Name in {微信, 支付宝, 现金}` can already be used as real-time payback / instant cashflow signals
- if `Payments[].Name = 会员` is materially present but `mart_daily_store_metrics.storedConsumeAmount = 0`, treat current stored-consume mart metrics as **not yet calibrated**

### 1.6 ClockType / AddClockType

- current working mapping:
  - `ClockType = 1` => 轮钟
  - `ClockType = 2` => 点钟
  - `ClockType = 3` => Call 钟
  - `ClockType = 4` => M 钟 / Buy 钟
- `AddClockType = 0` can be treated as non-add-clock
- `AddClockType != 0` can already be treated as add-clock for store-manager analysis
- exact subtype meaning of different non-zero `AddClockType` codes still needs official confirmation, so subtype-level analysis should stay conservative

### 1.7 ItemTypeName / ItemCategory / IsDonate

- `ItemTypeName` is already useful for project-type structure, for example `足浴类`, `按摩类`, `线上`
- `IsDonate` is already useful for giveaway / donation structure and should be surfaced as a caution in marketing analysis
- `ItemCategory` exists, but the final mapping needed to declare a strict “副项渗透率” KPI is still incomplete

## Endpoint Audit

### 1.1 会员基础信息

**Observed raw keys**

`Assets`, `Avatar`, `Birthday`, `ConsumeAmount`, `Coupons`, `CTime`, `Equitys`, `From`, `Id`, `Labels`, `LastConsumeTime`, `MarketerCode`, `MarketerId`, `MarketerName`, `Name`, `OrgId`, `Phone`, `Sex`, `SilentDays`, `StoredAmount`, `Storeds`, `Tickets`, `Type`

**Currently normalized**

- `memberId`, `name`, `phone`
- `storedAmount`, `consumeAmount`
- `createdTime`, `lastConsumeTime`, `silentDays`
- member cards are partially normalized into `fact_member_cards_current`

**High-value fields still raw-only**

- `From`
- `Sex`
- `Labels`
- `Coupons`
- `Storeds`
- `Tickets`
- `Equitys`
- `Marketer*`

**Immediate business value**

- member acquisition channel
- coupon effectiveness
- marketer attribution
- stored-card balance mix
- silent member risk by asset type

### 1.2 消费明细

**Observed raw keys**

`CallNumber`, `CCode`, `CName`, `Consume`, `CTime`, `DeductionAmount`, `DiscName`, `DiscountAmount`, `DonateAmount`, `FavAmount`, `FullcutAmount`, `HandCardCode`, `HandCardCodes`, `Infos`, `IntegralAmount`, `IntegralNum`, `IsAnti`, `OptCode`, `OptName`, `OptTime`, `Pay`, `Payments`, `Remark`, `RoomCode`, `RoomCodes`, `SettleId`, `SettleNo`, `ShoppromoAmount`, `SysId`, `TicketAmount`, `VirMode`, `VirTotal`

**Currently normalized**

- `settleId`, `settleNo`
- `payAmount`, `consumeAmount`, `discountAmount`
- `antiFlag`, `optTime`, `bizDate`

**Already proven useful in raw payloads**

- `Payments[].Name` already contains `会员`, `微信`, `现金`, `美团`, `抖音`, `支付宝`
- `Payments[].PaymentType` exists but platform rows currently appear as `-1`
- `CCode` exists and can support customer-level revisit analysis

**High-value fields still raw-only**

- `Payments`
- `Infos`
- `ShoppromoAmount`
- `CallNumber`
- `DeductionAmount`, `FavAmount`, `DonateAmount`, `FullcutAmount`, `TicketAmount`
- `RoomCode`
- `SysId`

**Immediate business value**

- 团购支付识别与平台拆分
- 客单优惠结构
- 副项/项目文本解析
- Call 钟辅助判断
- 团购客户回访与二次到店链路

### 1.3 充值明细

**Observed raw keys**

`CardId`, `CardNo`, `CardTypeId`, `CardTypeName`, `Category`, `ChainNoAnti`, `ChainTradeId`, `CorsOrgName`, `CouponNum`, `Donate`, `Id`, `Integral`, `IsAnti`, `IsNotAllowAnti`, `MemberName`, `MemberPhone`, `OptCode`, `OptId`, `OptName`, `OptTime`, `Pay`, `Payments`, `Reality`, `Sales`, `SnNo`, `SysId`, `TicketEquity`, `Tickets`, `Total`, `Type`

**Currently normalized**

- `rechargeId`
- `realityAmount`, `totalAmount`, `donateAmount`
- `antiFlag`, `optTime`, `bizDate`

**High-value fields still raw-only**

- `CardTypeName`
- `Payments`
- `Type`
- `CouponNum`
- `Sales`
- `Tickets`, `TicketEquity`

**Immediate business value**

- recharge campaign quality
- recharge card structure
- gifted-value ratio by card type
- recharge salesperson attribution

### 1.4 账户流水

**Observed raw keys**

`AntiTime`, `CardOptType`, `ChangeBalance`, `ChangeDonate`, `ChangeIntegral`, `ChangeReality`, `EndBalance`, `EndDonate`, `EndIntegral`, `EndReality`, `IsAnti`, `OptTime`, `OrgId`, `OrgName`, `PaymentType`, `TradeNo`

**Currently normalized**

- `tradeNo`, `optTime`, `bizDate`
- `cardOptType`
- `changeBalance`, `changeReality`, `changeDonate`, `changeIntegral`
- `paymentType`, `antiFlag`

**High-value fields still raw-only**

- `EndBalance`, `EndDonate`, `EndIntegral`, `EndReality`
- `AntiTime`
- `OrgName`

**Immediate business value**

- stored balance trajectory
- anti settlement timing
- card operation audit

### 1.5 技师基础信息

**Observed raw keys**

Representative high-value keys observed: `Code`, `Name`, `OrgId`, `OrgName`, `ClassId`, `ClassName`, `DeptId`, `DeptName`, `HireDate`, `IsWork`, `IsJob`, `PersonState`, `PersonStateName`, `PointClockNum`, `WheelClockNum`, `BaseWages`, `PostId`, `PostName`, `PostType`, `ItemCategory`, `ItemList`, plus many display/runtime fields.

**Currently normalized**

- `techCode`, `techName`
- `isWork`, `isJob`
- `pointClockNum`, `wheelClockNum`
- `baseWages`

**High-value fields still raw-only**

- `PersonState`, `PersonStateName`
- `Class*`, `Dept*`, `Post*`
- `HireDate`
- `ItemList`
- `IsMajor`, `IsManage`, `Sex`

**Immediate business value**

- technician laddering
- class/department staffing
- service-skill tags
- tenure and attrition analysis

### 1.6 技师上钟明细

**Observed raw keys**

`AddClockDesc`, `AddClockType`, `AddClockTypeComm`, `BasicComm`, `ClockType`, `Comm`, `Count`, `CTime`, `Duration`, `ETime`, `Income`, `IsAddWork`, `ItemCategory`, `ItemName`, `OverComm`, `PersonCode`, `PersonName`, `RoomCode`, `SettleNo`, `SettleTime`, `STime`, `Turnover`, `WaitTime`

**Currently normalized**

- `personCode`, `personName`
- `settleNo`, `handCardCode` when present
- `itemName`, `clockType`, `count`
- `turnover`, `comm`, `ctime`, `settleTime`, `bizDate`

**High-value fields still raw-only**

- `AddClockType`
- `AddClockDesc`
- `AddClockTypeComm`
- `ItemCategory`
- `BasicComm`
- `Duration`
- `Income`
- `IsAddWork`
- `OverComm`
- `RoomCode`, `WaitTime`, `STime`, `ETime`

**Immediate business value**

- 加钟率
- 点钟 / 轮钟 / Call 钟结构
- 时段产能
- 等位与空档
- 技师人效模型

### 1.7 技师推销提成

**Observed raw keys**

`AfterDisc`, `ClockType`, `Commission`, `Count`, `CTime`, `Discount`, `FavourShare`, `HandCardCode`, `Id`, `IsDonate`, `ItemCategory`, `ItemCode`, `ItemId`, `ItemName`, `ItemTypeName`, `PersonCode`, `PersonName`, `PostId`, `Price`, `RoomCode`, `SalesCode`, `SalesName`, `SettleNo`, `SettleTime`, `Sex`, `ShoppromoAmount`

**Currently normalized**

- `marketId`, `recordKey`
- `personCode`, `personName`
- `itemId`, `itemName`
- `count`, `afterDisc`, `commission`, `settleTime`, `bizDate`

**High-value fields still raw-only**

- `ItemTypeName`
- `ItemCategory`
- `IsDonate`
- `Price`
- `SalesCode`, `SalesName`
- `Discount`, `FavourShare`, `ShoppromoAmount`
- `ClockType`

**Immediate business value**

- 副项渗透率
- 项目类型结构
- 赠送推销识别
- 销售归因和推销漏斗

### 1.8 技师提成设置

**Observed raw keys**

`ItemId`, `ItemName`, `PCBaseList`

**Currently normalized**

- `itemId`, `itemName`
- `ruleHash`

**High-value fields still raw-only**

- `PCBaseList` full rule details

**Immediate business value**

- call / appoint / wheel / buy differential incentive analysis
- project-level commission strategy diagnostics

## Priority Normalization Recommendations

### P1: Immediate

- `1.2 Payments -> is_groupbuy / groupbuy_platform / payment_mix`
- `1.6 AddClockType -> is_add_clock / add_clock_type`
- `1.6 ClockType -> normalized clock type distribution`
- `1.7 ItemTypeName / IsDonate -> market item-type and donate summaries`

### P2: Next

- `1.2 Infos -> order item parsing`
- `1.2 CCode -> revisit and group-buy conversion chain`
- `1.5 HireDate / Class / Post -> technician lifecycle reporting`
- `1.8 PCBaseList -> commission-rule interpretation`

### P3: After doc semantics are confirmed

- exact addon penetration denominator using `ItemCategory`
- exact group-buy ROI formula using recharge linkage and revisit windows
- exact point-clock risk model linking members to technicians across stable customer keys

## Prompt-Upgrade Implication

The sidecar prompt should now treat:

- `团购` as available from real fields
- `加钟` as available from real fields
- `副项` as partially available from real fields, but still requiring a finalized business mapping before claiming a strict “副项渗透率” KPI
