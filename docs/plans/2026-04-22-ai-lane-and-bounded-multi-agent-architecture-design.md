# AI Lane And Bounded Multi-Agent Architecture Design

日期：2026-04-22
状态：proposed
范围：为 `htops` 引入统一 AI lane 定义与模型路由骨架，先完成第一批 6 条 lane，并为后续 HQ / doctor / world-model explanation 的 bounded multi-agent 演进建立统一边界。

## 0. 当前问题映射

当前仓库里的 AI 能力已经不是一处，而是分散在多个 owner path 中：

- `general-lite`
  - `hermes_overrides/sitecustomize.py`
- `semantic-fallback`
  - `src/ai-semantic-fallback.ts`
- `customer-growth-json`
  - `src/customer-growth/ai/client.ts`
- `cheap-summary`
  - `src/app/xiaohongshu-link-service.ts`
  - `src/external-intelligence/llm.ts`
- `analysis-premium`
  - `src/app/analysis-service.ts`
  - `tools/crewai-sidecar/store_review.py`
- `offline-review`
  - 当前仍更接近 future lane，后续主要接 `doctor / nightly review / semantic quality`

这带来 4 个现实问题：

1. AI 入口已经分散，但模型选择仍然是局部硬编码或局部配置，缺统一 owner。
2. “快路”和“深路”没有被系统性拆开，容易出现前门闲聊和深度分析吃同一类模型的情况。
3. 各环节 fallback 行为存在，但缺统一 lane contract，后续扩展 HQ / world-model / doctor 时会越来越碎。
4. 未来如果要演进到 bounded multi-agent，当前还缺“先有 lane、再有 agent”的底座。

---

## 一、结论

`htops` 下一阶段不应直接变成“多 agent 平台”，而应先收成：

**`deterministic core + unified AI lanes + bounded premium reasoning lanes`**

也就是说：

- `Capability Graph -> Query Plan -> Safe Execution` 继续是核心真相层
- AI 统一收口到可配置、可观测、可降级的 lane
- 强推理能力优先投到 `analysis / HQ / doctor / world-model explanation` 这些慢路径
- bounded multi-agent 只在慢路径上演进，不进入 query 主链

第一批先统一 6 条 lane：

1. `general-lite`
2. `semantic-fallback`
3. `customer-growth-json`
4. `cheap-summary`
5. `analysis-premium`
6. `offline-review`

并且第一波最值钱的能力升级应是：

**先把 `analysis-premium` 切到强推理模型。**

---

## 二、设计目标

### 1. 架构目标

- 让所有 AI 使用点先绑定 `lane`，而不是先绑定具体模型
- 让模型选择、thinking、timeout、fallback 从调用代码中解耦
- 不把新的业务职责继续塞进 `src/runtime.ts`
- 为 Python Hermes 前门和 TypeScript owner modules 提供同一套 lane 语义

### 2. 产品目标

- 前门普通问答更快
- 业务补槽更稳
- customer growth 小任务继续低成本、结构化
- analysis / HQ 后续能够显著增强“经营推理和动作优先级”能力

### 3. 进化目标

- 后续可新增 `hq-premium`
- 后续可新增 `world-model-explanation`
- 后续可新增 `doctor-review`
- 后续可在慢路径上演进到 bounded multi-agent

---

## 三、明确不做什么

这一版明确不做：

1. 不引入第二套 ontology runtime
2. 不让 AI 替代 `Capability Graph`
3. 不让 AI 替代 `Query Plan`
4. 不让 AI 直接拼 SQL
5. 不让 AI 直接替代事实层
6. 不让 `src/runtime.ts` 变成 AI 总控
7. 不把 query 主链改造成多 agent

---

## 四、统一 AI Lane 模型

### 1. Lane 的核心含义

`lane` 不是“一个模型名”，而是：

**一种被明确定义的 AI 任务形态。**

它至少包含：

- 这条 lane 处理什么任务
- 同步还是异步
- 输出是 `text` 还是 `json`
- 是否允许 thinking
- 可接受的延迟预算
- 失败后如何降级
- 归属哪个 owner module

### 2. Lane Contract

建议统一为以下 contract：

- `laneId`
- `taskClass`
  - `chat`
  - `json_extract`
  - `json_generate`
  - `summary`
  - `analysis`
  - `review`
- `executionMode`
  - `sync`
  - `async`
  - `batch`
- `provider`
- `baseUrl`
- `apiKey`
- `model`
- `reasoningMode`
  - `off`
  - `low`
  - `medium`
  - `high`
- `temperature`
- `timeoutMs`
- `responseMode`
  - `text`
  - `json`
- `fallbackBehavior`
  - `none`
  - `lane`
  - `deterministic`
  - `legacy`
- `fallbackLaneId`
- `ownerModule`
- `observabilityLabel`

### 3. 配置原则

统一从 `htops.json` 读取 `aiLanes` 顶层配置。

这样做有两个好处：

1. TypeScript 模块可以继续通过现有 `src/config.ts` 解析。
2. Python Hermes 前门可以直接读取同一份 JSON，不必引入额外 manifest 生成链。

旧配置继续兼容：

- `semanticFallback`
- `customerGrowthAi`
- `externalBriefLlm`
- `.hermes-runtime/config.yaml` 中的 Hermes 默认模型

但新代码优先读 `aiLanes`；旧配置只作为 fallback 和迁移兼容。

---

## 五、第一批 6 条 Lane

### 1. `general-lite`

- 用途：
  - 企微普通闲聊
  - 轻解释问题
  - 当前不是业务数据执行入口
- 当前 owner：
  - `hermes_overrides/sitecustomize.py`
- 推荐模型：
  - `DeepSeek-V3.2`
- reasoning：
  - `off`
- fallback：
  - 回落到 Hermes 原默认路径

判断：这是典型快路，不该吃强推理模型。

### 2. `semantic-fallback`

- 用途：
  - 只做 `intent/store/time/metric/clarify` 补槽
- 当前 owner：
  - `src/ai-semantic-fallback.ts`
- 推荐模型：
  - `DeepSeek-V3.2`
- reasoning：
  - `off`
- fallback：
  - rule intent / unresolved / clarify

判断：这是结构化 JSON 提取任务，不该吃旗舰模型。

### 3. `customer-growth-json`

- 用途：
  - 画像补充
  - 软标签建议
  - 跟进备注总结
  - 轻策略建议
- 当前 owner：
  - `src/customer-growth/ai/client.ts`
- 推荐模型：
  - `DeepSeek-V3.2`
- reasoning：
  - `off`
- fallback：
  - 返回 `null`，继续 deterministic owner path

判断：这是 bounded JSON 任务，应优先低成本、稳定输出。

### 4. `cheap-summary`

- 用途：
  - 小红书速读摘要
  - external brief 单条 narrative enrich
- 当前 owner：
  - `src/app/xiaohongshu-link-service.ts`
  - `src/external-intelligence/llm.ts`
- 推荐模型：
  - `Doubao-Seed-2.0-lite`
- reasoning：
  - `off`
- fallback：
  - deterministic fallback summary

判断：这是典型摘要类任务，不需要强推理。

### 5. `analysis-premium`

- 用途：
  - 单店 async 深度复盘
  - 后续 HQ premium synthesis 的基础 premium lane
- 当前 owner：
  - `src/app/analysis-service.ts`
- 推荐模型：
  - `gpt-5.4`
- reasoning：
  - `high`
- fallback：
  - deterministic bounded synthesis
  - scoped query analysis

判断：这是第一批里最适合吃强推理模型、也最值钱的一条 lane。

### 6. `offline-review`

- 用途：
  - nightly review
  - doctor taxonomy 扩展
  - failure clustering
  - backlog/sample 候选生成
- 当前 owner：
  - 当前先定义 lane，不急着接入主执行流
- 推荐模型：
  - `gpt-5.4`
- reasoning：
  - `high`
- fallback：
  - deterministic summary only

判断：这是典型 batch / offline lane，可慢、可深、可控。

---

## 六、为什么第一波先切 `analysis-premium`

当前仓库里，`analysis` 不是裸 prompt，而是已经形成了：

- `evidence pack`
- `diagnostic bundle`
- `orchestration plan`
- `fallback to deterministic bounded synthesis`

也就是说，它已经天然具备“先取证，再推理，再降级”的结构。

因此第一波最合理的能力增强路径不是：

- 把所有地方都换成大模型

而是：

1. 让 `general-lite` 回到快模型
2. 让 `analysis-premium` 升到强推理模型

这样既能提升前门速度，也能真正提升最值钱的经营推理能力。

---

## 七、统一代码组织建议

建议新增一个 cross-cutting owner module：

- `src/ai-lanes/types.ts`
- `src/ai-lanes/registry.ts`
- `src/ai-lanes/resolver.ts`
- `src/ai-lanes/observability.ts`

职责划分：

- `types.ts`
  - lane 类型定义
- `registry.ts`
  - 静态 lane id 与默认 lane contract
- `resolver.ts`
  - 配置合并、legacy fallback、lane 解析
- `observability.ts`
  - 将 lane -> model -> reasoning -> timeout 的当前映射暴露给 admin read / doctor

具体 owner module 继续保留：

- `general-lite` 仍归 `sitecustomize.py`
- `semantic-fallback` 仍归 `src/ai-semantic-fallback.ts`
- `customer-growth-json` 仍归 `src/customer-growth/ai/client.ts`
- `analysis-premium` 仍归 `src/app/analysis-service.ts`

也就是说，这一版是“统一 lane 定义 + 各 owner module 接同一套 contract”，不是把所有 AI 调用都收成一个大服务。

---

## 八、统一模型适配建议

### 当前建议的模型分配

| Lane | 推荐模型 | thinking |
|---|---|---|
| `general-lite` | `DeepSeek-V3.2` | `off` |
| `semantic-fallback` | `DeepSeek-V3.2` | `off` |
| `customer-growth-json` | `DeepSeek-V3.2` | `off` |
| `cheap-summary` | `Doubao-Seed-2.0-lite` | `off` |
| `analysis-premium` | `gpt-5.4` | `high` |
| `offline-review` | `gpt-5.4` | `high` |

### 暂不优先使用的模型位置

- `Kimi-K2.6`
  - 可作为 future premium / review 备选
  - 不优先放 `general-lite`
- `Doubao-Seed-2.0-pro`
  - 可作为 premium 备选
- code / agent 模型
  - 只用于开发和工具链，不进入生产经营问答主链

---

## 九、未来 bounded multi-agent 模块图

### 1. 总体原则

`htops` 未来适合的是：

**`single deterministic orchestrator + bounded specialist agents on slow lanes`**

而不是：

**`full-agent core runtime`**

### 2. 总图

```text
user / scheduler / nightly review
  -> deterministic front door
  -> capability graph / query plan / safe execution / evidence pack
  -> AI lane selector
      -> sync single-agent lanes
      -> async premium lanes
      -> batch review lanes
  -> structured result
  -> deterministic publish / action writeback
```

### 3. `analysis-premium` future module map

```text
deterministic evidence pack assembler
  -> signal reviewer agent
  -> root-cause synthesizer agent
  -> action planner agent
  -> narrative writer agent
  -> deterministic action guard / publish guard
```

边界：

- agent 不改 evidence pack 事实
- agent 不直接写 action store
- action writeback 仍由 deterministic owner module 完成

### 4. `hq-premium` future module map

```text
portfolio evidence assembler
  -> store comparator agent
  -> external-context impact agent
  -> resource allocation agent
  -> executive narrative agent
  -> deterministic publish guard
```

职责：

- 先比较门店
- 再判断外部环境影响
- 再给总部资源优先级
- 最后写成总部可读结论

### 5. `world-model-explanation` future module map

```text
world state snapshot
  -> mechanism explainer agent
  -> scenario evaluator agent
  -> risk narrator agent
  -> recommendation translator agent
```

边界：

- 仍然建立在 deterministic world state / mechanism 之上
- 不让 world model agent 绕开 capability graph / safe execution

### 6. `offline-review` future module map

```text
semantic audit / analysis failures / feedback snapshots
  -> failure clusterer agent
  -> taxonomy expander agent
  -> backlog proposer agent
  -> sample candidate writer agent
```

用途：

- 失败聚类
- taxonomy 扩展
- backlog 候选
- sample 候选

---

## 十、哪些环节永远不该多 agent

以下环节不应 agent 化：

- Hermes 前门业务路由
- semantic fallback 补槽
- capability graph 选择
- query plan 生成
- SQL 编译
- safe execution
- 权限与 scope
- 高频问数与日报
- action/store 事实写入

原因很简单：

这些环节的价值在于：

- 稳
- 快
- 可审计
- 可解释

而不是“更像一个会自己想办法的 agent”。

---

## 十一、分期建议

### Phase 1

目标：

- 统一 lane 定义
- 第一批 6 条 lane 接线
- `analysis-premium -> gpt-5.4`

### Phase 2

目标：

- 补 lane observability
- 接入 HQ premium synthesis
- 接入 doctor / nightly review

### Phase 3

目标：

- 给 `analysis-premium`
- `hq-premium`
- `offline-review`

逐步引入 bounded multi-agent 编排

### Phase 4

目标：

- 把 world-model explanation
- operating recommendation explanation
- learning loop

进一步收口为统一的慢路径智能参谋面

---

## 十二、推荐执行顺序

如果现在继续开干，推荐顺序应是：

1. 先建 `AI lane` owner module
2. 第一批接 6 条 lane
3. 当场把 `analysis-premium` 切到 `gpt-5.4`
4. 让 `general-lite` 回到快模型
5. 再把 HQ / doctor / world-model explanation 接到 lane
6. 最后再演进到 bounded multi-agent

这是当前最符合架构边界、业务价值和演进节奏的一条路径。
