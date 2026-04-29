# Semantic Recognition Hardening Design

## Goal

把 `htops` 当前“能覆盖不少高频经营问法，但一旦进入口语、多轮补槽、分天形态就容易失真”的前门语义链，再收紧一层。

这轮目标不是做“更会聊天”的 bot，而是把下面 4 件事一起做对：

1. `识别对`
   - 把用户话里的 `门店 / 时间 / 指标 / 对象 / 动作 / 回答形态` 识别准。
2. `路由对`
   - 把识别结果稳定落到 `semantic-intent -> capability-graph -> query-plan` 的正确能力节点，而不是掉进含糊 fallback。
3. `执行对`
   - 像“近3天每天的营收”“近5天每天的客流量”这类问法，不能在 plan 阶段塌缩成总量。
4. `回复对`
   - 回复文本必须忠实于执行结果，不把“分天明细”说成“总数”，也不能把兜底话术当成答案。

## Why Now

当前项目的主矛盾已经不是“数据库里有没有数据”，而是“系统有没有稳定听懂问题”。

真实故障集中在这几类：

1. 用户明确要 `每天 / 分天 / 列出每一天`，系统却返回总量。
2. 同一句话同时包含 `门店 + 时间窗 + 指标 + 输出形态` 时，系统只识别到一半。
3. 高频经营字段里，部分字段能答总量，换成分天后又退回 clarify 或 generic guidance。
4. 多轮补槽时，前一轮的门店/时间语义有时能延续，有时会被 topic switch 或 fallback 打断。
5. semantic quality 当前能看到失败，但还不能清楚分出“识别错”“规划错”“回答形态错”。

这会直接伤害体感准确率。对门店老板来说，“答非所问”比“暂时不会答”更伤信任。

## Current Main Chain

当前可接受的主链仍然保持不变：

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

仓库里的主 owner path 也是清楚的：

1. 入口与多轮状态：
   - `src/app/message-entry-service.ts`
   - `src/inbound.ts`
   - `src/app/conversation-semantic-state-service.ts`
   - `src/query-entry-adapter.ts`
2. 语义识别：
   - `src/query-semantics.ts`
   - `src/query-intent.ts`
   - `src/semantic-intent.ts`
3. 语义规划与能力约束：
   - `src/capability-graph.ts`
   - `src/query-plan.ts`
4. 执行与回复：
   - `src/query-engine.ts`
   - `src/metric-query.ts`
   - 相关 reply / render owner modules
5. 质量闭环：
   - `src/app/semantic-quality-service.ts`

本次设计不改变这条主链，不引入第二套 ontology runtime，也不把新职责塞进 `src/runtime.ts`。

## Approved Design Direction

### 1. Semantic Front Door Hardening

入口继续维持现有 owner path，不另起新路。

本层要解决的不是“AI 更聪明”，而是：

1. 多轮补槽时，哪些信息允许 carry forward，哪些必须清空。
2. `topic switch` 何时触发。
3. `clarify` 何时必须发，何时不应该乱发。
4. 企微侧高频短句在 `query-entry-adapter` 里怎样补足最低可执行语义。

目标是把 `conversation semantic state` 从“clarify carry”收紧成“受控补槽层”，而不是自由推断层。

### 2. Deterministic Semantic Recognition

主识别继续放在：

1. `src/query-semantics.ts`
2. `src/query-intent.ts`

这轮新增的不是“更多 prompt”，而是一层更明确的语义槽位归一化。建议把当前识别结果统一收成下面 6 组语义槽：

1. `scope`
   - `single`
   - `multi`
   - `five-store`
   - `binding-default`
2. `time`
   - `single-day`
   - `window`
   - `window-timeseries`
   - `comparison-window`
3. `metric`
   - 标准经营字段白名单，如 `serviceRevenue`、`customerCount`、`serviceOrderCount`、`rechargeCash`、`pointClockCount`、`addClockCount`
4. `object`
   - `store`
   - `hq`
   - `customer`
   - `tech`
5. `action`
   - `summary`
   - `compare`
   - `ranking`
   - `trend`
   - `report`
   - `advice`
6. `response_shape`
   - `scalar`
   - `timeseries`
   - `ranking_list`
   - `table`
   - `narrative`

关键原则：

1. “每天 / 分天 / 列出每一天 / 趋势 / 近N天每天” 必须优先改变 `response_shape`，而不是仅仅改变 `timeFrame`。
2. `response_shape` 必须是显式语义，不允许依赖 reply renderer 猜。
3. `metric` 只允许走白名单映射，不做自由发挥字段扩展。

### 3. Capability-Constrained Planning

`src/capability-graph.ts` 和 `src/query-plan.ts` 负责把“识别结果”转成“可执行计划”。

这层必须收紧两件事：

1. `timeseries / breakdown / summary` 不能在 plan 阶段互相塌缩。
2. 同一个指标在不同回答形态下，要映射到不同 capability contract。

例如：

1. `义乌店近三天营收`
   - 可以是 `summary`
2. `义乌店近三天每天的营收`
   - 必须是 `timeseries`
3. `五店近7天每天营收对比`
   - 必须是 `timeseries + multi-scope`
4. `义乌店近5天每天的点钟数/加钟数`
   - 必须是 `breakdown/timeseries`，不能退回单指标 summary

也就是说，planning 层要把“用户想看什么形态”视为能力契约的一部分，而不是后处理样式。

### 4. Quality Loop

`src/app/semantic-quality-service.ts` 需要把失败类型拆得更细，否则后续优化会一直混在一起。

建议新增或强化以下 failure taxonomy：

1. `semantic_parse_gap`
   - 语义槽位抽取错了
2. `clarify_gap`
   - 本该澄清没澄清，或不该澄清却澄清了
3. `capability_mapping_gap`
   - 识别结果无法稳定落到 capability / query plan
4. `response_shape_gap`
   - 用户要分天，结果被答成总量
5. `reply_render_gap`
   - 执行结果对了，但回复文本说错了

这样后面看质量报表时，我们知道该修：

1. `src/query-semantics.ts`
2. `src/query-intent.ts`
3. `src/query-plan.ts`
4. `src/query-engine.ts`
5. reply renderer

而不是继续一股脑加 AI fallback。

## First Cut

第一刀只打最值钱、最可验证的一块：

`时间窗 + 分天/每天 + 标准经营字段白名单`

原因很直接：

1. 这是当前最容易让用户觉得“完全没听懂”的场景。
2. 它同时暴露 `识别问题` 和 `回答形态问题`。
3. 做好以后会立刻提升企微体感准确率。
4. 它完全落在现有 capability graph / safe execution 主链内，不需要另起框架。

### First-Cut Query Families

第一刀覆盖的真实问法包括：

1. `义乌店近三天每天的客流量`
2. `义乌店近5天每天的营收 / 单数 / 客单价 / 储值`
3. `义乌店近7天每天的点钟数 / 加钟数`
4. `五店近7天每天营收对比`
5. `这几天义乌店每天情况`
6. `昨天 / 近7天 / 近30天` 与 `每天 / 分天 / 列出每一天` 的组合

### First-Cut Module Touch Map

预计第一刀主要落在这些 owner modules：

1. `src/query-semantics.ts`
2. `src/query-intent.ts`
3. `src/query-entry-adapter.ts`
4. `src/query-plan.ts`
5. `src/capability-graph.ts`
6. `src/query-engine.ts`
7. `src/metric-query.ts`
8. `src/app/conversation-semantic-state-service.ts`
9. 对应 utterance fixtures / route eval / tests

## Alternatives Considered

### Option A: 继续主要靠 AI fallback 补理解

不选。

原因：

1. 会把主识别器从 deterministic owner path 偷偷变成 prompt path。
2. 很难稳定保证 `timeseries` 与 `summary` 的边界。
3. 不符合当前项目“bounded AI, deterministic control surface”的硬规则。

### Option B: 先大改 ontology / world model，再反哺问答

现在不选。

原因：

1. 当前最痛的问题是前门语义识别，不是 world model 缺失。
2. 这会把 HQ / external intelligence / world model 的议题混进当前急需修复的识别问题。
3. 不符合“先修高频真实闭环，再扩高层语义”的节奏。

### Option C: 先收紧 deterministic front door，再用 quality loop 定位后续扩点

推荐。

原因：

1. 与当前 `Ontos-lite` 路径一致。
2. 与现有 capability graph / safe execution 完全兼容。
3. 最容易用 route-eval、clarify 率、fallback 率验证。

## Acceptance Criteria

这轮不是看“感觉更聪明”，而是看下面几类指标能否可验证提升：

1. 高频真实问法 route-eval 命中率提升。
2. `clarify` 率下降，但不是靠瞎猜下降。
3. `ai_fallback` 使用率下降。
4. `entry_unresolved` 下降。
5. “每天 / 分天” 问法不再被答成总量。

## Test Strategy

先补失败样本，再补实现。

本轮第一批测试会集中在：

1. `src/query-semantics.test.ts`
2. `src/query-intent.test.ts`
3. `src/query-entry-adapter.test.ts`
4. `src/route-eval.test.ts`
5. `src/app/conversation-semantic-state-service.test.ts`
6. 需要时补 `src/query-engine.test.ts`

## Non-Goals

这轮明确不做下面这些危险动作：

1. 不把新入口职责继续塞进 `src/runtime.ts`
2. 不让 AI fallback 变成主识别器
3. 不绕过 `src/capability-graph.ts` 和 safe execution
4. 不把 HQ / world-model / 外部态势层一起揉进来
5. 不为了“全都能答”引入第二套 ontology runtime

## Rollout Note

本设计默认分两步推进：

1. 先收第一刀：
   - `时间窗 + 分天/每天 + 标准经营字段白名单`
2. 再扩第二刀：
   - 多轮补槽
   - topic switch
   - 复合问法 response shape
   - semantic quality taxonomy 细化

这样做能保证每一刀都有可见收益，也不会把语义层重构成一场大爆炸。
