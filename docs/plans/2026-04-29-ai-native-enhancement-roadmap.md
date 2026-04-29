# AI-Native Enhancement Roadmap

日期：2026-04-29  
状态：approved direction  
范围：把 README 里的 `P0 / P1 / P2` 从高层口号展开为一份面向项目内部的 AI-native 增强路线图，统一战略叙事、技术方向、模块落点、依赖顺序与阶段验收标准。

---

## 0. 为什么现在做这份路线图

`htops` 现在已经不只是一个“会出报表的运营系统”，也不只是一个“能在企微里查经营数据的机器人”。从当前仓库状态看，它已经具备了 AI-native 经营智能系统的最小骨架：

- 有 `Semantic Intent` 作为语义入口
- 有 `Capability Graph` 作为能力路由面
- 有 `Serving Semantic Layer + Safe Execution` 作为确定性真相和执行边界
- 有 `analysis worker` 作为慢路径认知层
- 有 `conversation review / semantic quality / doctor` 作为质量反馈闭环
- 有 `AI lanes` 作为模型分层和成本/时延控制基础

问题不在于“有没有 AI”，而在于：

1. AI 的使用点已经出现，但仍偏分散，尚未变成统一的经营智能主线。
2. AI 的使用率还不够高，很多真正需要“理解、归因、优先级判断”的环节仍偏弱。
3. AI 的效率还不够高，语义入口、能力选择、异步分析、质量复盘之间还没有形成真正的放大链条。

因此，这份路线图要回答的不是“要不要做 AI”，而是：

**如何让 `htops` 从“有 AI 增强能力的运营系统”，演进成“AI-native 的经营智能基础设施”。**

---

## 1. 北极星目标

项目的目标形态统一定义为：

`Deterministic business truth + semantic operating system + bounded AI agents + execution feedback loop`

用更业务化的话说：

1. **先把经营事实做成本地真相层**
   所有重要经营判断都必须能落回本地事实和可审计执行结果。
2. **再把自然语言和经营语义做成操作系统**
   用户输入不只是命令或闲聊，而是可识别、可路由、可执行的经营意图。
3. **让 AI 负责 cognition，不负责 truth**
   AI 主要做理解、归因、比较、优先级、解释、复盘与弱信号增强，不直接接管事实层。
4. **把经营输出接回执行闭环**
   系统不止回答“发生了什么”，而要逐步支持“该做什么、做完如何验证、结果如何影响下次决策”。

---

## 2. 路线图总表

| 阶段 | 核心主题 | 主要目标 | 价值焦点 | 主要模块 |
| --- | --- | --- | --- | --- |
| `P0` | 强化语义入口与上下文继承 | 让系统更会“认路” | 提高 AI 的识别率与正确选路率 | `src/semantic-intent.ts` `src/app/conversation-semantic-state-service.ts` `src/app/message-entry-service.ts` `src/inbound.ts` |
| `P1` | 扩展 Capability Graph 与决策面 | 让系统更会“选对能力” | 提高 AI 的业务覆盖与决策表达力 | `src/capability-graph.ts` `src/query-plan.ts` `src/query-engine.ts` `src/app/reporting-service.ts` |
| `P2` | 做深 analysis worker 与学习闭环 | 让系统更会“思考并持续变强” | 提高 AI 的分析深度、反馈利用率与长期收益 | `src/app/analysis-service.ts` `src/app/analysis-execution-service.ts` `src/app/semantic-quality-service.ts` `src/app/conversation-review-service.ts` |

---

## 3. 总体原则

### 3.1 先强语义主链，再强模型能力

如果语义入口、能力选择、事实边界都不稳，换更强模型只会更贵、更慢，也更难调试。

### 3.2 AI 只增强 cognition，不替代 truth

以下链路必须保持确定性主导：

- `src/client.ts`
- `src/normalize.ts`
- `src/sync.ts`
- `src/store.ts`
- serving 读层与 safe execution 主链

### 3.3 先做 bounded agent，不做无界多 agent

多 agent 不是当前第一优先级。当前最值钱的是：

- lane 更清晰
- capability 更完整
- async analysis 更强
- review / quality loop 真正接到优化链

### 3.4 任何 AI 增强都必须能被观察和回退

每一条 AI 路径都至少应具备：

- owner module
- fallback contract
- timeout budget
- route observability
- failure sample capture

---

## 4. P0：强化语义入口与上下文继承

### 4.1 阶段目标

让系统先更会“理解用户到底想干什么”，减少以下低级损耗：

- 问法变化就掉到错误 lane
- 第二句话补槽时丢上下文
- 老板式 / 口语式问法无法稳定映射到 query / analysis
- clarify 问题和真实执行问题混在一起

一句话：

**P0 的目标不是让 AI 更聪明，而是先让 AI 更会认路。**

### 4.2 为什么这是第一优先级

这是当前所有 AI ROI 的乘数层。

如果 `Semantic Intent` 和 `conversation semantic state` 做不强：

- `Capability Graph` 再丰富也选不到
- `analysis worker` 再强也接不到正确问题
- `semantic quality loop` 收到的只是错误入口噪音

### 4.3 P0 的主工作流

#### Workstream A：Semantic Intent 强化

目标：

- 扩展 HQ、门店、顾客经营、风险、动作、复盘类问法的识别覆盖
- 收敛“口语表达 -> 结构化意图”的映射稳定性

模块：

- `src/semantic-intent.ts`
- `src/query-intent.ts`
- `src/query-semantics.ts`

预期收益：

- 单轮问法识别更稳
- 路由误判率下降
- “AI 认不出用户想法”的浪费明显减少

#### Workstream B：Conversation Semantic State 做强

目标：

- 多轮补槽
- topic switch reset
- 角色/门店/时间上下文继承
- clarify 后的稳定接续

模块：

- `src/app/conversation-semantic-state-service.ts`
- `src/store/conversation-semantic-state-store.ts`
- `src/app/message-entry-service.ts`
- `src/inbound.ts`

预期收益：

- 用户不需要每句都重复店名和时间
- 复杂追问更像“持续对话”而不是“每轮重新开机”

#### Workstream C：入口失败样本回灌

目标：

- 把高频意图失败样本直接接到 capability / semantic intent 主链的优化输入

模块：

- `src/app/semantic-quality-service.ts`
- `src/app/conversation-review-service.ts`
- `src/ops/doctor.ts`

预期收益：

- 语义入口的优化进入可度量状态
- “为什么前门认错了”不再只靠人工猜

### 4.4 P0 验收标准

满足以下条件可以认为 P0 完成：

1. 高价值 HQ / 门店口语问法命中正确 lane 的比例显著提升。
2. 多轮 clarify / 补槽 / topic switch 有稳定 carry 行为。
3. `doctor` 或 admin read 可以看见 semantic failure 的主要来源和聚类。
4. 新增失败样本能够稳定流入 semantic quality backlog。

### 4.5 P0 非目标

- 不引入第二套 ontology runtime
- 不做多 agent 编排
- 不把 AI 接入事实写入链
- 不先追求更“华丽”的总结文案

---

## 5. P1：扩展 Capability Graph 与决策面

### 5.1 阶段目标

让系统从“会识别问题”进一步升级到“会选对能力”，也就是把 AI 从语义入口推进到业务决策面。

一句话：

**P1 的目标不是让模型多说话，而是让系统拥有更多可执行的经营能力节点。**

### 5.2 为什么这是第二优先级

当前很多 AI 路径已经能把问题识别到 `query` 或 `analysis`，但系统内部可以选的 capability 仍有限。这会导致：

- 路由正确，但能力不够丰富
- AI 只能掉回泛化文案，而不是进入真正的业务 owner path
- HQ、customer-growth、industry-context 的高价值问题还没有统一吃到图谱

### 5.3 P1 的主工作流

#### Workstream A：扩展 HQ 决策 capability

目标：

- HQ 总览
- HQ 风险迁移
- HQ 资源优先级
- HQ 行业弱信号读取

模块：

- `src/capability-graph.ts`
- `src/query-plan.ts`
- `src/query-engine.ts`
- `src/app/reporting-service.ts`

预期收益：

- AI 不再只会“单店解释”，而能进入总部决策面
- HQ 问题的表达能力明显增强

#### Workstream B：扩展 customer-growth / action capability

目标：

- 顾客画像读取
- 分层召回执行
- 门店动作建议
- 结果回写与 follow-up 读面

模块：

- `src/customer-growth/*`
- `src/app/reactivation-execution-service.ts`
- `src/tools/contracts.ts`
- `src/tools/handlers.ts`

预期收益：

- AI 从“说出问题”走向“给出下一步可执行动作”

#### Workstream C：把 industry-context 纳入统一 capability surface

目标：

- 让外部情报、行业态势、弱信号解释进入统一 capability graph 边界

模块：

- `src/industry-context.ts`
- `src/external-intelligence/*`
- `src/capability-graph.ts`

预期收益：

- AI 在 HQ 决策面不只看店内数据，还能看受控弱信号

### 5.4 P1 验收标准

满足以下条件可以认为 P1 完成：

1. HQ 高价值问法可以稳定落到明确 capability，而不是泛化输出。
2. customer-growth 与动作执行类能力在 graph 中有清晰 owner surface。
3. 外部情报 / 行业上下文能通过 bounded read path 被 HQ 使用。
4. route / capability observability 能反映新增能力是否真的被命中。

### 5.5 P1 非目标

- 不让 AI 替代 query plan
- 不让 AI 自己发明新 SQL
- 不做无边界工具规划

---

## 6. P2：做深 analysis worker 与学习闭环

### 6.1 阶段目标

让系统从“能认路、能选能力”进一步升级到“会做深思考，而且会持续变强”。

一句话：

**P2 的目标是把 async cognition 和质量反馈真正做成经营智能的学习引擎。**

### 6.2 为什么这是第三优先级

没有 P0 和 P1，P2 会变成昂贵的空转：

- 入口不稳，分析吃不到正确问题
- capability 太少，分析结果落不到执行面
- 质量反馈不闭环，AI 只会重复犯错

但一旦前两层成形，P2 就是最值钱的复利层。

### 6.3 P2 的主工作流

#### Workstream A：增强 bounded analysis orchestration

目标：

- evidence pack
- diagnostic signals
- bounded synthesis
- action items

模块：

- `src/app/analysis-execution-service.ts`
- `src/app/analysis-service.ts`
- `src/app/analysis-orchestration-plan.ts`

预期收益：

- AI 能进行更深的经营诊断，而不是一次性 prompt 输出
- 每个阶段都能被解释、测试和回退

#### Workstream B：semantic quality loop 真正闭环

目标：

- 失败样本归档
- owner module backlog
- deploy follow-up
- 路由漂移与质量回归监控

模块：

- `src/app/semantic-quality-service.ts`
- `src/app/conversation-review-service.ts`
- `src/store/semantic-execution-audit-store.ts`
- `src/ops/doctor.ts`

预期收益：

- AI 变强不靠“换个 prompt 再试试”
- 系统有稳定的学习输入和验证输出

#### Workstream C：把执行反馈接回 AI

目标：

- 行动是否被执行
- 用户是否采纳
- 到店 / 转化 / 风险缓解是否发生
- 这些结果如何反向影响下次 AI 的优先级判断

模块：

- `src/customer-growth/*`
- `src/app/delivery-service.ts`
- `src/app/reporting-service.ts`
- `src/app/semantic-quality-service.ts`

预期收益：

- AI 不再只根据“说得像不像”优化
- AI 开始根据“业务结果有没有变好”优化

### 6.4 P2 验收标准

满足以下条件可以认为 P2 完成：

1. analysis worker 的 stage graph 明确且可观测。
2. semantic quality backlog 能稳定吸收真实失败样本。
3. action outcome 能影响下一轮 AI 优先级或建议生成。
4. HQ / 门店的高价值深分析能力开始体现持续增强效果。

### 6.5 P2 非目标

- 不做无界自治 agent
- 不让 AI 自动改代码或自动上线
- 不让模型绕过 deterministic truth layer

---

## 7. 工程落点总图

### 7.1 模块映射

| 层 | 主要 owner | 当前状态 | 路线图重点 |
| --- | --- | --- | --- |
| 语义入口 | `src/semantic-intent.ts` `src/inbound.ts` | 有骨架 | P0 做强识别与上下文 |
| 语义状态 | `src/app/conversation-semantic-state-service.ts` | 已接线 | P0 做强多轮继承 |
| 能力图谱 | `src/capability-graph.ts` | 已成型 | P1 扩能力覆盖 |
| query / render | `src/query-engine.ts` `src/query-plan.ts` | 稳定 | P1 让 capability 更值钱 |
| 分析 worker | `src/app/analysis-service.ts` | 已有慢路径 | P2 做深 bounded cognition |
| 质量环 | `src/app/semantic-quality-service.ts` `src/app/conversation-review-service.ts` | 已接线 | P2 做真闭环 |
| AI lanes | `src/ai-lanes/*` | 已成型 | P1/P2 做 specialization 与 observability |

### 7.2 跨阶段依赖

1. `P0 -> P1`
   没有稳定语义入口，就没有高质量 capability 命中。
2. `P1 -> P2`
   没有丰富 capability surface，analysis 结果无法稳定落地。
3. `P0 -> P2`
   没有 conversation semantic state，深分析会缺上下文。

---

## 8. 关键指标

路线图推进不应只看“写了多少代码”，而应看以下指标：

### 8.1 P0 指标

- semantic route accuracy
- clarify carry success rate
- topic switch reset correctness
- top semantic failure classes

### 8.2 P1 指标

- capability coverage for HQ / store / customer-growth asks
- fallback rate from intended capability to generic output
- new capability hit rate

### 8.3 P2 指标

- analysis completion rate
- structured action extraction success rate
- review finding to backlog conversion rate
- post-deploy semantic regression rate
- action outcome feedback coverage

---

## 9. 明确不做什么

这份路线图明确反对以下方向：

1. 把 AI 放进原始事实接入主链
2. 引入第二套 ontology runtime
3. 直接做全局多 agent 平台
4. 让 query 主链为了“更聪明”而变慢、变不可控
5. 用更多模型调用代替更好的 capability 设计

---

## 10. 推荐推进顺序

建议的执行顺序是：

1. 先把 `P0` 做透
2. 再让 `P1` 扩 capability surface
3. 最后在 `P2` 上建立真正的学习复利

如果顺序反过来，会出现：

- 更贵的 AI
- 更慢的分析
- 更多的错答
- 更难解释的系统行为

---

## 11. 一句话收束

这份路线图的真正目标，不是让 `htops` “更像 AI 产品”，而是让它：

**从一个带 AI 增强的经营系统，演进成一个以确定性经营真相为底座、以语义操作系统为中层、以 bounded AI agent 为认知层、以执行反馈为闭环的 AI-native 经营智能基础设施。**
