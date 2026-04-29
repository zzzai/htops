# 迎宾店旧 MySQL 导入设计

## 背景

本地 `/root/ybmysql/Mysql.zip` 恢复出的旧 MySQL 并不是简单备份表，而是旧版门店 SaaS 的完整业务库快照。当前最有价值的是迎宾店历史数据，它覆盖了会员卡主档、充值流水、消费流水、结算支付明细，以及一批会员卡历史备份数据。

现有项目已经具备完整的 PostgreSQL 核心数仓与衍生重建链路：

- `fact_member_current`
- `fact_member_cards_current`
- `fact_consume_bills`
- `fact_recharge_bills`
- `fact_user_trades`
- `fact_member_daily_snapshot`
- `mart_member_reactivation_features_daily`
- `mart_member_reactivation_strategies_daily`

因此目标不是重建一套新仓，而是把旧 MySQL 历史数据稳定导入现有仓，并让历史画像、召回优先级模型直接受益。

## 目标

- 优先补齐迎宾店历史会员链路
- 优先补齐储值轨迹与消费结算链路
- 不破坏现有 API 同步链路和查询服务
- 导入完成后可直接复用现有快照、画像、召回重建脚本

## 备选方案

### 方案 A：全表盲导到 PostgreSQL 原样镜像

优点：

- 开发最快
- 几乎不需要理解业务

缺点：

- 会在现有项目里引入第二套 schema
- 查询层、画像层、召回层都用不上
- 之后仍然要再做一次映射清洗

结论：拒绝。

### 方案 B：旧 MySQL 直接写新 SQL，跳过现有仓

优点：

- 可以一次性把历史分析直接做出来

缺点：

- 和现有 `HetangOpsStore`、Serving 层、画像链路割裂
- 容易形成双套指标口径
- 后续维护成本高

结论：拒绝。

### 方案 C：旧 MySQL 映射到现有事实表，再复用衍生层

优点：

- 与现有项目主架构一致
- 风险最小
- 问答、画像、召回、Serving 立即获得历史补强
- 后续可以按表逐步扩展，不需要一次性吃掉全部旧库

缺点：

- 需要做字段映射与去重逻辑
- 首次导入要谨慎控制物化视图刷新

结论：采用。

## 导入范围

首期只做迎宾店，并以 6 张高价值核心表为主：

1. `res_member_card_create`
2. `res_member_card_createbak`
3. `exe_member_recharge`
4. `exe_consumeritems`
5. `exe_settlement_detail`
6. `exe_orderinfo`

其中：

- `res_member_card_create` 负责当前会员卡主档
- `res_member_card_createbak` 负责历史卡状态快照恢复
- `exe_member_recharge` 负责储值轨迹
- `exe_consumeritems` 负责消费事实
- `exe_settlement_detail` 负责支付拆分和会员卡扣款补强
- `exe_orderinfo` 先作为消费补链辅助数据保留在原始 JSON 中

## 目标表映射

### 1. 会员主档

旧源：

- `res_member_card_create`

写入：

- `fact_member_current`
- `fact_member_cards_current`

原则：

- 以 `userid` 作为优先成员标识
- 若 `userid` 缺失，则回退到 `mobile + number` 生成稳定 member key
- `raw_json` 采用兼容现有 `normalizeMemberRow` / `normalizeMemberCardRows` 的 API 风格结构

### 2. 会员卡历史快照

旧源：

- `res_member_card_createbak`

写入：

- `fact_member_daily_snapshot`
- `fact_member_cards_daily_snapshot`

原则：

- 按 `BAKDATETIME` 归档到业务日
- 以同一卡号同一天最后一条备份记录为准
- 构造兼容现有快照回读逻辑的 `raw_json`

### 3. 充值事实

旧源：

- `exe_member_recharge`

写入：

- `fact_recharge_bills`

原则：

- 主键使用 `exe_member_recharge_id`
- `CANCELFLAG=1` 视为冲销或无效单
- 业务日由 `OPTIME` 落到当前项目的业务日口径

### 4. 消费事实

旧源：

- `exe_consumeritems`

写入：

- `fact_consume_bills`

原则：

- 主键优先使用 `EXE_CONSUMERITEMS_ID`
- `SETTLEMENT_SHEET_ID` / `EXE_SETTLEMENT_SHEET_SN` 进入 `raw_json`
- `CANCELFLAG=1` 记为反单

### 5. 支付与储值扣减补强

旧源：

- `exe_settlement_detail`

写入：

- `fact_user_trades`

原则：

- 只抽取可明确识别为会员卡余额变动的记录
- 按 `EXE_CONSUMERITEMS_ID + MCARD_ID + SETTLETIME + USEMONEY` 生成稳定 fingerprint
- 用于改善历史储值轨迹与日快照回推

## 去重策略

旧库 `wwdb` 与 `2` 都是迎宾店，且存在明显重叠。导入时不能直接累加。

去重原则：

- 当前事实表由 PostgreSQL 主键兜底幂等
- 读取阶段仍做预去重，减少无效写入
- 优先顺序：`wwdb` 先、`2` 后
- 同一业务主键冲突时：
  - 优先保留时间更晚、字段更完整的记录
  - 若无法判断，则保留先到记录并记录冲突计数

## 刷新策略

旧仓导入会写入大量事实数据，不能继续沿用“每次 upsert 自动 refresh 全量物化视图”的模式。

本次实现要求：

- 导入模块在批量写入期间关闭视图刷新
- 全部事实层写完后，统一执行一次 `forceRebuildAnalyticsViews`
- 历史快照和召回链路重建期间也关闭中途 refresh

## 技术实现

新增模块：

- `src/legacy-mysql-import.ts`
- `src/legacy-mysql-import.test.ts`
- `scripts/import-legacy-yingbin.ts`

必要依赖：

- 增加 `mysql2`

职责划分：

- `src/legacy-mysql-import.ts`
  - MySQL 读取
  - 行映射
  - 预去重
  - 批量写入现有 `HetangOpsStore`
- `scripts/import-legacy-yingbin.ts`
  - CLI 入口
  - 连接配置
  - 导入范围控制
  - 导入后触发历史快照与召回重建

## 风险点

### 1. `raw_json` 兼容性

当前快照回读逻辑会重新解析 `raw_json`。因此不能直接把旧 MySQL 原始行整体塞进去，必须构造成现有代码可识别的兼容结构。

### 2. 会员主键不统一

旧库存在 `userid`、`number`、`mobile` 多种身份字段，必须在映射层统一成稳定的 `memberId`。

### 3. 历史快照重复

同一天可能存在多次卡状态备份。必须按同卡同日保留最后版本，避免快照污染。

### 4. 视图刷新过重

如果沿用逐批自动刷新，导入时间会被物化视图刷新拖垮，甚至影响正常查询。

## 验收标准

- 能从恢复容器读取迎宾店旧库
- 能把会员主档、会员卡、充值、消费、交易补强写入 PostgreSQL
- 旧库重复数据不会导致事实表重复膨胀
- 导入后能成功跑完：
  - `rebuildMemberDailySnapshotsForDateRange`
  - `rebuildCustomerIntelligenceForDateRange`
  - `rebuildMemberReactivationFeaturesForDateRange`
  - `rebuildMemberReactivationStrategiesForDateRange`
- 迎宾店召回优先级相关查询能看到历史补强后的结果
