# Customer Growth Production-Grade Design

日期：2026-04-19
状态：in-progress
范围：用户画像、标签、分层、召回、执行反馈、AI 介入、门店级调优、生产稳定性

## 2026-04-19 当前已落地

- 执行摘要读路径已显式关闭 AI followup summarizer，不再因 `summary` 查询触发备注级 LLM 调用
- `listExecutionTasks` 已补 `includeAiAdvisory` 开关，AI 总结从隐式行为升级为显式行为
- `stores[].customerGrowth.primarySegmentThresholds` 已进入配置解析链
- customer intelligence 主分层已接入门店级 `primarySegmentThresholds` 覆盖能力
- 报表构建、scheduled catchup、本地 catchup 已能把 `storeConfig` 继续传入 customer intelligence owner path
- customer growth 已补“单一稳定客户才归因”的保守型安全归因规则
- `customer segments / conversion cohorts / reactivation features` 已不再把多人稳定客户消费单重复记入个人经营算分
- 执行反馈已新增 `reactivation outcome snapshot` 物化层，写反馈时会生成可回灌学习快照
- 跟进备注已支持“写路径 AI 结构化复盘 + 确定性 note signals”双轨沉淀，但不改 execution facts
- strategy 层已能读取近 90 天 outcome snapshots，对 `primarySegment + recommendedActionLabel` 做 bounded learning calibration
- queue 层已支持“门店日触达容量”感知分带，优先按显式 `dailyTouchCapacity`，缺省再退回老的相对百分比分带

## 背景

当前方案已经具备可运行闭环：

- `画像/分层 -> 召回策略 -> 队列 -> 执行反馈`
- AI 已进入 `画像 insight / 软标签建议 / 召回话术建议 / 跟进备注总结`
- 环境上下文、24 节气、门店外部知识已经进入解释层或部分策略层

但系统仍偏向：

- `Deterministic Growth Rules Engine + AI Copilot`

尚未达到：

- `Production-Grade Adaptive Customer Growth Engine`

## 评审结论转设计目标

本轮改造目标不是推翻现有 owner path，而是把现有 MVP 升级到可长期演进的生产架构：

1. 读链路稳定：不能让只读查询轻易触发批量 LLM
2. 决策可调：关键分层与召回阈值支持门店级调优
3. 反馈可学习：执行反馈逐步回灌到下一轮画像与策略
4. 数据可追责：归因、外部知识、AI 输出都要保留明确边界
5. AI 真正嵌入：AI 从“解释层”逐步进入“候选层、建议层、校准层”

## 备选方案

### 方案 A：继续在当前规则引擎上零散补功能

优点：

- 改动最小
- 交付最快

缺点：

- 线上风险继续堆积
- AI 依旧停留在装饰层
- 未来每次扩店、扩品类、扩门店画像都会越来越难调

### 方案 B：保留 deterministic 内核，补 production-grade 壳层

核心思路：

- 保留 `feature -> strategy -> queue -> execution` 主链
- 在外层补 `配置化调优 + AI 调用治理 + 学习回灌 + 数据边界治理`

优点：

- 风险最低
- 与当前代码结构最兼容
- 能分期落地，不需要大规模中断现网

缺点：

- 短期内仍不是纯 AI-native 排序器
- 需要接受“规则内核 + AI 校准层”一段时间并存

### 方案 C：直接重构为 AI-native 画像与召回平台

优点：

- 理论上最终上限更高

缺点：

- 风险极高
- 数据口径、可解释性、线上稳定性都会短期倒退
- 明显不符合当前仓库的 Ontos-lite 演进边界

## 推荐方案

选择 **方案 B**。

理由：

- 与当前 `src/customer-growth/` owner path 最兼容
- 符合仓库“不引入第二套 ontology runtime”的约束
- 可以把“AI 深度融入”拆成多批次安全演进，而不是一次性把排序权全部交给模型

## 目标架构

### 1. 决策主链

保持主链：

- `identity + behavior facts -> feature rows -> strategy rows -> queue rows -> execution feedback`

但补 4 层生产能力：

- `tuning layer`：门店级 customer growth 调优配置
- `ai governance layer`：读写路径 AI 调用治理、限流、降级、缓存/物化
- `learning layer`：把执行反馈沉淀为可回灌特征
- `evidence layer`：外部知识、AI 建议、研究备注全部保留 truth level

### 2. AI 介入分层

AI 分三层介入，不直接一次性接管排序：

1. `候选层`
   - 生成软标签、标签假设、异议归因、召回切入点建议
2. `校准层`
   - 基于执行反馈与外部上下文，对 deterministic 结果做 bounded 调整建议
3. `解释层`
   - 输出画像总结、话术建议、跟进复盘、门店上下文解释

短期原则：

- AI 可以提出候选与解释
- 排序、主分层、执行状态仍保留 deterministic safe shell

## 分期路线图

### Wave 1：生产稳定化（本轮先开工）

目标：先把现网最危险的问题降下来。

交付：

- 执行读链路 AI gating，避免 `summary` 触发全量 LLM
- 把执行类 AI 建议变成显式开关/限额策略
- 引入门店级 customer growth tuning 配置入口
- 先把主分层阈值从“纯硬编码”升级为“默认值 + 门店覆盖”

### Wave 2：决策正确性

目标：让画像和召回更可信。

交付：

- 修正多会员消费单的金额/到店归因策略
- 为分层、召回、优先级增加门店级校准面板
- 引入容量约束，priority band 从“相对排名”升级为“产能感知”

当前状态：

- 多人稳定客户安全归因：已完成
- 容量感知 priority band：已完成第一版，先用 `store.customerGrowth.reactivationCapacity.dailyTouchCapacity` 和门店规模估算做最小闭环
- 更细的 staff / 排班 / 当日负荷联动：后续批次

### Wave 3：反馈学习化（已启动）

目标：让系统开始具备自学习闭环。

交付：

- 把 `contacted/replied/booked/arrived/closed + note` 变成学习特征
- 生成 `reactivation outcome snapshot`
- 用执行结果反推标签可信度、建议命中率、异议模式

### Wave 4：AI 深度决策

目标：让 AI 真正影响经营动作，但保持安全壳。

交付：

- AI 候选标签进入可审核物化层
- AI 对召回动作给出 bounded boost/penalty 建议
- 外部知识、节气、天气、门店经营画像统一进入 AI-safe context assembler

## 数据与存储原则

结构化经营事实：

- PostgreSQL 为主存储与 serving truth source

半结构化知识快照：

- `md/json` 作为可审阅输入资产
- 导入 PG 后形成标准 snapshot

AI 可消费上下文：

- 一律从 PG snapshot / serving rows / AI-safe assembler 构造
- 不直接让模型读取散落文档并自行猜测事实

## 关键设计约束

1. 不在 `src/runtime.ts` 新增业务入口责任
2. customer growth 继续收敛在 `src/customer-growth/`
3. 外部知识只通过 assembler 进入 AI，不直接改主评分
4. AI 输出必须是 bounded、可禁用、可降级、可追踪
5. 任何 production-grade 改造都优先补测试

## 本轮实施边界

本轮已完成 Wave 1 全量首批与 Wave 3 的第一步：

1. 执行读链路 AI 治理
2. 门店级 customer growth tuning 配置入口
3. 将主分层先接到 tuning 层
4. 多人稳定客户消费单安全归因
5. 执行反馈学习快照与 bounded calibration 首批落地
6. 召回 queue 容量感知 priority band 首批落地

学习结果进一步回灌 feature/tag/queue，以及 staff / 排班 / 当日负荷联动的更强容量模型，放到后续批次。
