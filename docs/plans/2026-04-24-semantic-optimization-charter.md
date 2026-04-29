# Semantic Optimization Charter

## Goal

把 `htops` 的语义优化从“修一批 badcase”升级成“有明确合同、有清晰边界、有稳定质量闭环”的持续工程。

本 charter 约束的不是单个 prompt，而是整条主链：

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

## Scope

本 charter 只约束 `htops` 的语义识别、能力映射、clarify 策略、owner module 执行边界与语义质量闭环。

它不批准以下方向：

1. 引入第二套 ontology runtime。
2. 让 AI 直接替代 capability graph / query plan / safe execution。
3. 把新的业务入口职责继续塞进 `src/runtime.ts`。
4. 用 ad-hoc routing 代替 capability graph owner path。

## Non-Negotiable Principles

### 1. 先做 Semantic Slot Contract，不只做 Intent Label

所有高频经营问法都必须优先收敛成显式语义槽位，而不是只输出一个粗粒度 `intent kind`。

当前最低要求包括：

1. `scope`
2. `time`
3. `metric`
4. `object`
5. `action`
6. `response_shape`
7. 必要时补充 bounded hints，例如：
   - `hqOverviewHint`
   - `customerSegmentProfileHint`
   - `customerMembershipScopeHint`
   - `storePriorityTradeoffHint`
   - `customerSubjectHintText`
   - `techSubjectHintText`

### 2. Planner 和 Executor 不再重复读原句

前门语义一旦产出 intent contract，planner、executor、renderer、owner module 应尽量消费 hint / slot，不再各自二次 regex 原句。

允许保留 `rawText` 的场景只包括：

1. request id / normalized question 等元数据
2. 仍未 contract 化的低风险展示文案分支
3. 明确受限的实体抽取过渡期

### 3. Clarify 只在缺关键槽位时触发

clarify 必须是 deterministic policy，不是 AI 猜不准就随便追问。

当前关键槽位只包括：

1. `store`
2. `time`
3. `metric`
4. 明显混杂的 `scope / object`

### 4. 高频 Badcase 必须进入 Route-Eval 和 Owner Tests

修过的 badcase 不能只停留在聊天记录里，必须固化进：

1. `route-eval`
2. owner module tests
3. 必要时的 utterance sample libraries

### 5. 所有新能力先进 Capability Graph

任何新的查询 / 报表 / 经营能力，必须先明确 capability contract，再进入 planner / executor。

contract 最少要写清：

1. `required_slots`
2. `optional_slots`
3. `clarification_policy`
4. `failure_hints`
5. `fallback_capability_ids`

### 6. 大模型只做 Bounded Fallback 和高价值分析

大模型可以做：

1. bounded semantic fallback
2. bounded JSON extract
3. 高价值经营分析
4. async/offline review

大模型不能做：

1. 绕过 capability graph 直接执行
2. 接管 deterministic control surface
3. 成为 planner / safe execution 的替代品

## Current Status

截至 `2026-04-24`，当前分支已经把这套 charter 的核心主链推进到“可执行状态”，但还没到“全项目收口状态”。

### 已经比较扎实的部分

1. `query-semantics -> query-intent` 已经不再只是 label routing，而是显式承载 response shape、time granularity、specialized hints。
2. `query-engine-executor`、`query-engine-renderer`、`store-query`、`customer-growth/query` 的高频主链已经明显减少二次读原句。
3. `metric/report/hq/customer-growth` 主链的高频 badcase 已经稳定进入 owner tests。
4. `clarify` 已经开始受 capability contract 与 rule front door 约束，而不是优先走 AI fallback。
5. `semantic-fallback` 已经处于 bounded lane，而不是主执行器。

### 还没有完全收口的部分

1. specialized owner modules 仍有一批 `rawText` 分支没有 slot 化。
2. `clarify` 还没有完全沉到统一的 slot-missing taxonomy。
3. route-eval 样本虽然已经很多，但还没有形成“生产 badcase -> 每日增量样本 -> 自动回归”的闭环。
4. semantic quality taxonomy 还没完全扩成 `parse / clarify / mapping / shape / render` 五段闭环。

## Completion Estimate

> 说明：以下百分比是基于当前分支代码与测试覆盖的工程化估算，不是线上 SLA，也不是业务最终准确率。

### 语义优化主纲完成度

1. `Semantic slot contract`：`60%`
   - 核心主链已落地，但 specialized owner modules 还没全进入 contract。
2. `Planner / executor 不再重复读原句`：`58%`
   - 高频主链已明显改善，但 `wait/member marketing/recharge/birthday/arrival/tech profile` 仍有残留。
3. `Clarify 只在缺关键槽位时触发`：`68%`
   - rule clarifier 与 capability clarification policy 已经成型，但跨轮补槽和 mixed-scope 策略还需继续收紧。
4. `Badcase -> route-eval / owner tests`：`74%`
   - 基础设施与高频样本已铺开，但自动化闭环还没完全打通。
5. `Capability graph first`：`80%`
   - 已经成为主路径，但仍需继续压制 specialized 模块里的 ad-hoc 判断。
6. `Bounded AI only`：`85%`
   - 当前 lane 架构与 fallback 行为已经比较清楚，风险主要在个别边角回退路径。

### Overall

1. `高频主链完成度`：约 `83%`
   - 主要指 `metric / report / hq / customer-growth` 高价值主链。
2. `全项目语义优化完成度`：约 `71%`
   - 这里把所有 specialized owner modules 也算进去。

## Next Optimization Backlog

### P0

#### 1. 把 Specialized Owner Modules 全部推进到 Slot Contract

优先模块：

1. `src/wait-experience-query.ts`
2. `src/member-marketing-query.ts`
3. `src/recharge-attribution-query.ts`
4. `src/birthday-query.ts`
5. `src/arrival-profile-query.ts`
6. `src/tech-profile.ts`

目标：

1. 从 `rawText` regex 迁移到 intent hints / semantic slots
2. 补对应 owner tests
3. 把 specialized badcase 进入 route-eval sample libraries

#### 2. 收紧 Clarify Contract

目标：

1. 把 clarify 统一归到 `missing_store / missing_time / missing_metric / mixed_scope / missing_object_scope`
2. 让 `conversation semantic state` 更稳定地承载补槽，而不是临时拼接
3. 降低“其实能执行，却被误澄清”的比例

#### 3. 打通生产 Badcase -> Route-Eval 的增量闭环

目标：

1. 从 conversation review / semantic quality 中稳定抽取高频失败样本
2. 自动进入 sample library / fixture builder
3. 形成周更或日更回归集

### P1

#### 1. 扩 semantic quality taxonomy

把失败闭环显式拆成：

1. `semantic_parse_gap`
2. `clarify_gap`
3. `capability_mapping_gap`
4. `response_shape_gap`
5. `reply_render_gap`

#### 2. 继续补实体级 subject hints

后续可以扩展：

1. `techSubjectHintText` 到 `tech_profile`
2. `birthday qualifier hints`
3. `arrival window hints`
4. `member marketing scenario hints`

#### 3. 收拾低风险 metadata rawText

例如：

1. `src/query-plan.ts` 的 request id / normalized question

这类不是准确率 blocker，但可以在后续让 contract 更纯。

### P2

#### 1. 做一个 semantic optimization dashboard

把：

1. success
2. clarify
3. fallback
4. failure taxonomy
5. top badcases

直接暴露给 doctor / admin read / review service。

#### 2. 建立“新能力接入检查表”

要求所有新模块接入前先回答：

1. capability contract 是什么
2. required slots 是什么
3. clarify policy 是什么
4. route-eval 样本有哪些
5. AI lane 是否真有必要

## Done Criteria

当以下条件同时成立时，semantic optimization 才能算“阶段性完成”：

1. 所有高频 owner modules 都不再依赖 `rawText` 做主判断。
2. clarify 基本只发生在缺关键槽位时。
3. 高频 badcase 都能在 route-eval / owner tests 里复现。
4. capability graph 成为所有新经营能力的默认入口。
5. AI lane 只承担 bounded fallback 与高价值分析，不接管执行面。
