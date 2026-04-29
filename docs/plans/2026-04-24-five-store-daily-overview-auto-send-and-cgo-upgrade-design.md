# 5店昨日经营总览自动直发与 CGO 级升级设计文档

日期：2026-04-24
状态：approved
范围：修复“5 店昨日经营总览”自动发送卡点，并把内容从共享战报升级为更接近顶级 CGO 的经营判断读面

## 一句话定义

这次不是新增一份报表，而是把已有的 `5 店昨日经营总览` 从“可预览的共享战报”升级成“单店日报完成后自动直发的组合盘经营判断层”。

## 背景

当前仓库里这条链已经有最小闭环：

- deterministic renderer 已落地：`src/five-store-daily-overview.ts`
- service 组装与发送已落地：`src/app/reporting-service.ts`
- 调度 job 已落地：`send-five-store-daily-overview`
- 调度等待规则已落地：`send-report:<runKey>` 完成后再发
- admin / doctor 可观测摘要已落地

但当前又有两个真实问题：

1. 自动发送还没有真正“日报完成后直接进共享群”
2. 内容虽然稳定，但还不是“通过数据抓主矛盾、给出唯一优先动作”的 CGO 级输出

## 当前真实卡点

### 1. 自动发送的结构性卡点

`send-five-store-daily-overview` 当前在调度面虽然已排队，但真正发送时仍会走 `resolveDailyReport(...)`，而该路径会把部分已完成缓存日报重新判成需要刷新：

- `src/app/reporting-service.ts` 中的 `cachedReportNeedsMarkdownRefresh(...)`
- `src/app/admin-read-service.ts` 中的 `needsDailyReportMarkdownRefresh(...)`

这两个判断目前还把包含 `【补充指标】` 的新版日报当成 `refresh-needed`，导致：

- admin / doctor 面显示 `0/5 ready`
- 5 店总览在发送时会重走 `buildDailyStoreReport(...)`
- 某些门店又被 customer mart 唯一键冲突拖慢，形成“日报明明已缓存，5 店总览却卡 waiting”的错觉

这不是事实层缺失，而是 freshness 判定与发送读取策略不匹配。

### 2. 内容层的真实不足

当前总览的 6 段结构稳定，但更接近“店长共看版横向战报”，不够像“组合盘经营判断”：

- 更像汇总，不够像判断
- 会列变化，但不总能指出唯一主矛盾
- 能给动作，但还不够像“唯一优先动作”
- 没有把每家店在组合盘里的角色说清楚

因此升级重点不能只是“换文风”，而是先升级 finding layer。

## 本次目标

本次设计要同时达成 4 件事：

1. 单店日报全部发送完成后，5 店总览自动直发 `reporting.sharedDelivery`
2. 5 店总览发送时优先吃稳定缓存日报，不在发送时重建日报
3. 总览内容升级成“总判断 -> 结构拆解 -> 角色图 -> 非对称变化 -> 系统约束 -> 今日动作”
4. 仍保持 deterministic-first，不让 AI 主导事实判断

## 不做什么

- 不引入第二套报表 snapshot truth source
- 不把新职责继续塞进 `src/runtime.ts`
- 不让 AI 直接决定“核心问题是什么”
- 不把 HQ 周报 / world model / 行业态势层混入这次改动
- 不把自动发送建立在 ad-hoc shell 脚本上

## 方案对比

### 方案 A：只修自动发送

做法：

- 去掉 `【补充指标】 -> refresh-needed`
- 调度后直接群发

优点：

- 改动小
- 能快速恢复自动发送

缺点：

- 内容层仍旧偏“汇总型共享战报”
- 不能回答“为什么这份总览值得每天看”

### 方案 B：稳定发送 + finding layer 升级（推荐）

做法：

- 自动链改为单店日报完成后直发 shared delivery
- 发送时优先只读 `mart_daily_store_reports`
- 升级 deterministic findings，把总览从“列指标”改成“抓主矛盾”
- 如需后续润色，只允许在 findings 之后做 bounded expression

优点：

- 同时解决“发不出去”和“发出去不够强”
- 不破坏当前 reporting owner-path
- 最符合 repo 当前 deterministic / safe execution 边界

缺点：

- 比纯修发送多一轮 renderer 与测试改造

### 方案 C：强模型主分析版

做法：

- 直接把 5 家日报事实喂给强模型生成日总览

优点：

- 语言表现可能更华丽

缺点：

- 稳定性差
- 难回归
- 和当前 deterministic reporting 主线冲突

## 推荐方案

采用方案 B。

核心理由：

- 自动发送问题本质是“稳定事实已存在，但 freshness / read path 选错了”
- 内容问题本质是“finding layer 不够强”，不是“文风不够强”
- 这两件事都应该落在现有 owner modules 内解决

## 目标架构

### 1. 发送链

自动链：

`send-report completed -> send-five-store-daily-overview -> direct send sharedDelivery`

手工链保留：

- `render`
- `preview`
- `cancel`
- `confirm`

也就是说：

- 调度自动发送走 direct 模式
- 手工运营仍可用 preview gate 做人工检查
- 两者共用同一份 renderer 和同一份 truth source

### 2. 事实读取策略

5 店总览发送时读取策略调整为：

1. 当前日报优先读取 `mart_daily_store_reports`
2. 若缓存日报存在且 `complete=true`，直接使用
3. 若缓存缺失或 `complete=false`，才判 `waiting`
4. 基线日报 `bizDate - 7` 同样优先读缓存；缺失时才受控补算

关键变化：

- 不再因为新版 markdown 包含 `【补充指标】` 而触发 rebuild
- 发送时不再把日报重建当成正常路径

### 3. 内容升级后的 6 段

总段数仍保持 6 段，但内核升级：

1. 总判断
   回答昨天 5 店组合盘到底是增长、承压还是结构失衡。

2. 结构拆解
   按第一性原理拆成：
   - 流量
   - 转化
   - 效率
   - 现金与会员

3. 门店角色图
   每家店不只给排名，还给组合角色：
   - 增长引擎店
   - 效率样板店
   - 风险修复店
   - 结构失衡店
   - 稳定底盘店

4. 非对称变化
   显式解释“客流降但营收涨”“客流涨但营收不涨”这类结构错位。

5. 系统约束点
   只保留一个 5 店层面的主矛盾，不平铺多个问题。

6. 今日动作
   - 全店只给一个共同动作
   - 只给一个“最值得复制”的动作
   - 每店只给一个唯一优先动作

## finding layer 设计

新增一层 deterministic finding model，先在 renderer 内实现，必要时后续再外提：

- `growth_source`
  - traffic_led
  - conversion_led
  - efficiency_led
  - cashflow_led
  - mixed

- `drag_source`
  - traffic
  - point_clock
  - add_clock
  - clock_effect
  - customer_value
  - member_cashflow

- `structural_asymmetry`
  - revenue_up_traffic_down
  - traffic_up_revenue_flat
  - conversion_up_revenue_flat
  - none

- `store_role`
  - growth_engine
  - efficiency_model
  - repair_first
  - structure_imbalance
  - stable_base

- `system_constraint`
  5 店层面的唯一主约束点

- `today_priority_action`
  今天唯一优先动作

这里的核心边界是：

- findings 必须由规则和稳定数据导出
- 文风可以更锋利，但结论不能只靠 prompt 生成

## 关键模块映射

- 自动发送与稳定日报读取：
  - `src/app/reporting-service.ts`
  - `src/sync-orchestrator.ts`
  - `src/schedule.ts`
  - `src/config.ts`

- 状态面误判修复：
  - `src/app/admin-read-service.ts`
  - `src/ops/doctor.ts`

- 总览 renderer 升级：
  - `src/five-store-daily-overview.ts`
  - `src/types.ts`

- 回归覆盖：
  - `src/five-store-daily-overview.test.ts`
  - `src/app/reporting-service-five-store-overview.test.ts`
  - `src/ops/doctor.test.ts`
  - `src/cli.test.ts`
  - `src/runtime.test.ts`
  - `src/sync-orchestrator-five-store-overview.test.ts`

## 验收标准

### 自动发送

- 单店日报全部发送完成后，调度自动把 5 店总览直发到 `reporting.sharedDelivery`
- `doctor` / `admin read` 不再把新版含 `【补充指标】` 的日报误判为 `refresh-needed`
- 5 店总览发送不再因为新版日报格式而触发 rebuild

### 内容升级

- 总览必须能输出唯一主判断，而不是重复报数
- 至少能稳定识别一类组合盘主矛盾
- 每家店必须有明确角色和唯一优先动作
- 能解释至少一类非对称变化

## 风险与边界

### 风险 1：直接删除 preview gate 导致手工运营失去控制面

处理：

- 自动链改为 direct send
- 手工 preview / confirm / cancel 入口保留

### 风险 2：finding 规则过多，renderer 变得不可维护

处理：

- 先只做最小 finding set
- reason code 结构化，避免文案和规则完全耦合

### 风险 3：把“更深刻”误做成“更长”

处理：

- 只允许一个系统约束点
- 每店只允许一个唯一优先动作
- 不允许堆概念和空话

## 最终结论

这次升级的正确做法，不是“让 5 店总览写得更像 CEO 发言”，而是：

**让它从稳定日报事实中自动提取组合盘主矛盾，并在单店日报全部发送完成后，稳定、直接、自动地发到共享群。**

只有先把这两件事做对，后面的 AI 表达升级才是加分项，而不是风险源。
