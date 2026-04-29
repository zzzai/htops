# 门店每日环境记忆（Store Environment Memory）设计文档

日期：2026-04-23  
状态：approved  
范围：为 `htops` 增加“每店每日环境记忆快照”能力，自动采集天气、自动判定中国节假日与周几，并把这些环境标签长期沉到 PostgreSQL，供 analysis / world-model / reporting 内部读取，但默认不直接输出到日报或 5 店总览正文。

## 一、背景

仓库已经有一条被批准的 bounded 环境上下文线：

- `src/customer-growth/environment-context.ts`
- `src/environment-context.ts`
- `src/query-engine-renderer.ts`
- `src/world-model/state.ts`

这条线当前已经能做几件事：

- 由 `bizDate` 推导 `seasonTag / monthTag / isWeekend / solarTerm`
- 由简单天气输入推导 `weatherTag / temperatureBand / precipitationTag / windTag`
- 进一步推导 `badWeatherTouchPenalty / postDinnerLeisureBias / eveningOutingLikelihood`
- 在 customer growth 和 analysis explanation 中做 bounded 使用

但它当前仍存在一个关键缺口：

**系统会“算环境上下文”，但还不会“长期记住环境上下文”。**

这会带来 4 个现实问题：

1. 同一天的天气 / 节气 / 周几 / 节假日信息仍偏临时推导，不是长期可复用记忆。
2. 报表、analysis、world-model、doctor 之间还没有共享同一份环境快照。
3. 中国式节假日与调休错位还没有正式 owner truth source。
4. 系统可以看起来“偶尔聪明”，但还不是稳定地“自己记得这些背景”。

因此，这一轮要做的不是再加一段文案，而是补一层：

**每日自动采集、自动判定、长期沉淀、默认隐式使用的环境记忆层。**

---

## 二、设计目标

### 目标内

- 为每家门店每天生成一份 `store environment memory snapshot`
- 自动判定：
  - 周几
  - 是否周末
  - 中国节假日 / 假前 / 假后 / 调休工作日
  - 节气
  - 天气离散标签
- 以 PostgreSQL 作为长期 truth source
- 让 analysis / world-model / doctor / reporting 内部可读
- 默认不把这些背景直接写进日报与 5 店总览
- 只在强扰动日让正文层有资格引用

### 目标外

- 不引入第二套 ontology runtime
- 不让 AI 决定天气、节假日、周几
- 不让环境记忆覆盖经营交易事实
- 不把这层直接变成店长可见的大段背景播报
- 不在正文生成时临时联网查天气

---

## 三、设计原则

### 1. 这是“长期记忆层”，不是“文案层”

这层的首要职责是让系统长期记得：

- 那天是不是周三
- 那天是不是调休工作日
- 那天是不是清明前一天
- 那天是不是暴雨、降温、大风

它不是为了让日报每天多一段“天气播报”。

### 2. 环境记忆只做修正与解释，不做经营主事实

经营事实仍来自：

- PostgreSQL 里的交易、到店、储值、排钟、日报等事实

环境记忆只做：

- explanation 修正
- narrative gating
- world-model 环境状态补充
- customer growth 的 bounded nudging

不做：

- 覆盖经营事实
- 改 capability graph 主链
- 直接决定经营结论真假

### 3. 默认隐藏，强扰动才允许说

这层的核心不是“知道天气”，而是“知道什么时候值得提天气/节假日”。

因此第一版必须内建两个字段：

- `environmentDisturbanceLevel = none | low | medium | high`
- `narrativePolicy = suppress | hint | mention`

默认：

- 普通工作日 + 平稳天气 = `suppress`
- 不出现在日报或 5 店总览正文

只有强扰动日才：

- `hint`：允许在总判断里带一句
- `mention`：允许单列成背景校准

### 4. 周几 / 节气 / 节假日 / 天气都必须 deterministic

第一版不让 AI 判：

- 节假日类型
- 调休错位
- 天气强弱
- 是否该提背景因子

这些都要有明确规则和可测试输出。

---

## 四、方案对比

### 方案 A：继续只做运行时临时推导

优点：

- 成本最低
- 改动最少

缺点：

- 没有长期记忆
- 各模块复用同一环境背景的能力差
- 不能稳定支持 doctor / world-model / explanation

### 方案 B：复用 `store_external_context_entries`

优点：

- 不新增环境专用表
- 能复用既有 assembler

缺点：

- 语义不干净
- `周几 / 节假日` 不是 external intelligence
- 后续 environment / external intelligence / industry signal 会混淆

### 方案 C：新增独立的每日环境记忆 owner path

优点：

- 语义清晰
- 最贴近当前已批准的 environment-context 演进方向
- 最适合作为 world-model / analysis / reporting 的共享记忆层

缺点：

- 需要补一条专门的 snapshot build / store / read 链

## 五、推荐方案

选择 **方案 C**。

一句话：

**把天气、节假日、周几、节气做成“每店每日环境记忆快照”，自动生成、长期存储、默认隐式使用。**

---

## 六、总体架构

推荐的数据流如下：

`bizDate + 中国节假日日历 + 天气采集 + store master location -> environment memory builder -> PostgreSQL daily snapshot -> world-model / analysis / reporting 内部读取`

具体拆成 4 层。

### 1. Calendar Truth Layer

职责：

- 维护中国节假日与调休日历
- 为任意 `bizDate` 提供确定性判定

### 2. Weather Observation Layer

职责：

- 为门店所属城市 / 经纬度自动采集指定营业日天气
- 保留原始观测字段

### 3. Environment Memory Builder

职责：

- 复用现有 `environment-context` 推导逻辑
- 补充中国节假日、调休、扰动强度、叙事策略
- 产出最终 daily snapshot

### 4. Environment Memory Consumers

第一批 consumer：

- reporting / five-store overview
- analysis explanation
- world-model
- customer growth
- admin / doctor

---

## 七、数据模型

### A. `china_holiday_calendar_days`

这是全国共享的中国节假日日历表，不按门店分。

建议字段：

- `biz_date`
- `holiday_tag`
  - `workday`
  - `adjusted_workday`
  - `weekend`
  - `holiday`
  - `pre_holiday`
  - `post_holiday`
- `holiday_name`
- `is_adjusted_workday`
- `source_version`
- `source_label`
- `raw_json`
- `updated_at`
- `created_at`

说明：

- 第一版不在运行时临时抓网页判节假日
- 采用 repo / DB 内可维护的权威 calendar seed
- 运行时自动判，但日历数据本身受控维护

### B. `store_environment_daily_snapshots`

这是真正给 htops 读取的长期记忆真相层。

主键：

- `org_id`
- `biz_date`

建议字段：

- `org_id`
- `biz_date`
- `weekday_index`
- `weekday_label`
- `is_weekend`
- `holiday_tag`
- `holiday_name`
- `is_adjusted_workday`
- `season_tag`
- `month_tag`
- `solar_term`
- `weather_condition_raw`
- `temperature_c`
- `precipitation_mm`
- `wind_level`
- `weather_tag`
- `temperature_band`
- `precipitation_tag`
- `wind_tag`
- `bad_weather_touch_penalty`
- `post_dinner_leisure_bias`
- `evening_outing_likelihood`
- `environment_disturbance_level`
- `narrative_policy`
- `snapshot_json`
- `source_json`
- `collected_at`
- `updated_at`
- `created_at`

其中最关键的两个“聪明字段”：

- `environment_disturbance_level`
  - `none | low | medium | high`
- `narrative_policy`
  - `suppress | hint | mention`

这两个字段决定：

- 系统是否只在内部记住
- 还是允许正文层引用

---

## 八、自动采集与自动判定

### 1. 周几 / 周末

来源：

- 本地 deterministic 推导

输出：

- `weekdayIndex`
- `weekdayLabel`
- `isWeekend`

### 2. 中国节假日 / 调休

来源：

- `china_holiday_calendar_days`

输出：

- `holidayTag`
- `holidayName`
- `isAdjustedWorkday`

第一版必须能识别：

- 法定节假日
- 假前一天
- 假后第一天
- 普通周末
- 调休工作日

### 3. 节气

来源：

- 本地 deterministic 推导

继续复用：

- `src/customer-growth/environment-context.ts`

### 4. 天气

来源：

- 门店主数据中的 `city / latitude / longitude`
- 历史天气 observation provider

第一版要求：

- 采“上一营业日已发生天气”
- 不采“当前实时天气”
- 不在正文生成时临时联网

输出：

- 原始字段：
  - `weatherConditionRaw`
  - `temperatureC`
  - `precipitationMm`
  - `windLevel`
- bounded tags：
  - `weatherTag`
  - `temperatureBand`
  - `precipitationTag`
  - `windTag`
  - `badWeatherTouchPenalty`

### 5. 环境扰动强度判定

这是第一版最关键的新增规则层。

建议规则：

- `high`
  - 长假核心日
  - 调休错位强影响日
  - 暴雨 / 风雪 / 强风 / 明显降温
- `medium`
  - 假前一天 / 假后第一天
  - 中雨 / 明显闷热 / 明显寒冷
- `low`
  - 普通周末
  - 轻微天气变化
- `none`
  - 普通工作日 + 平稳天气

再进一步映射：

- `none -> suppress`
- `low -> suppress`
- `medium -> hint`
- `high -> mention`

---

## 九、模块映射

### 1. Environment Memory Builder Owner

建议新增：

- `src/environment-memory.ts`

职责：

- 读取 holiday calendar
- 读取 raw weather observation
- 复用 `buildEnvironmentContextSnapshot(...)`
- 计算 `environmentDisturbanceLevel / narrativePolicy`
- 输出 snapshot contract

### 2. App Service Owner

建议新增：

- `src/app/environment-memory-service.ts`

职责：

- `buildStoreEnvironmentMemory(...)`
- `ensureStoreEnvironmentMemory(...)`
- `getStoreEnvironmentMemory(...)`

### 3. Persistence Owner

继续落在：

- `src/store.ts`

新增 store methods：

- holiday calendar upsert / read
- environment snapshot upsert / read

### 4. Scheduler Owner

建议新增 job：

- `build-store-environment-memory`

位置：

- `src/schedule.ts`
- `src/sync-orchestrator.ts`

运行时序：

1. sync 完成
2. build-store-environment-memory
3. build-report
4. send-report
5. send-five-store-daily-overview

### 5. Consumer Mapping

- reporting：
  - 只读 `narrativePolicy`
  - 默认不直接输出背景
- five-store overview：
  - 只在 `hint/mention` 时允许引用
- analysis explanation：
  - 作为解释证据使用
- world-model：
  - 作为 `storeState.environmentContext` 长期记忆输入
- customer growth：
  - 优先读 snapshot，不再完全依赖临时构造
- admin / doctor：
  - 读取 readiness 与最近扰动概况

---

## 十、默认隐藏与正文输出边界

这是这条线必须写死的产品规则：

### 默认规则

- 日报默认不输出天气、节假日、周几、节气
- 5 店总览默认不单列背景因子
- analysis 可内部使用，但不必每次都说

### 允许输出条件

只有满足下面任一条件，正文层才允许消费：

- `narrativePolicy = hint`
- `narrativePolicy = mention`

### 强制禁止

以下行为第一版明确禁止：

- 正文层把普通工作日背景因子单独写成固定章节
- LLM 自己决定“今天天气影响很大”
- 环境标签覆盖经营事实判断
- 因为节气/天气就直接改经营结论

---

## 十一、可观测性

第一版必须补两类可观测性。

### 1. readiness

查看某个 `bizDate`：

- 5 店里有几家已经生成环境记忆
- 哪家缺 holiday calendar
- 哪家缺 weather observation
- 哪家是 fallback 生成

### 2. disturbance summary

查看最近 7 天：

- 哪些天被判成 `medium/high`
- 为什么被判高扰动
- 系统最近有没有“过度爱提背景因子”

适合接入：

- `src/app/admin-read-service.ts`
- `src/ops/doctor.ts`

---

## 十二、风险边界

这一轮明确不要碰：

1. 不让环境记忆进入 capability graph 主语义决策。
2. 不让这条线扩成第二套 ontology runtime。
3. 不在正文生成时临时联网抓天气。
4. 不在门店主数据不完整时长期依赖模糊城市猜测。
5. 不把环境因子直接塞进经营主评分。
6. 不让 AI 判节假日、调休、天气强弱或是否该 mention。

---

## 十三、第一刀建议

如果现在开始执行，第一刀不应该先改日报文案，而应该先做：

1. `china_holiday_calendar_days`
2. `store_environment_daily_snapshots`
3. `environment memory builder`
4. `build-store-environment-memory` 调度

原因：

- 这是底座
- 有了底座，reporting / analysis / world-model 才能共享同一份环境记忆
- 没有这层，系统仍只是“临时聪明”，不是“长期记得”

---

## 十四、与现有批准设计的关系

本设计不是新架构，而是对现有批准路径的收口与深化：

- 继承 `environment-context-strategy-first` 的 bounded 环境层
- 继承 `solar-term` 的本地 deterministic 原则
- 与 `Operating Intelligence` 主路径兼容
- 为 `world-model v1` 提供更稳定的 store environment memory

一句话总结：

**这次要做的，不是让系统更会“聊天气”，而是让系统真正开始“记住环境”。**
