# Analysis Lens Role Contract V2

日期：2026-04-18
状态：done
范围：query analysis 输出层

---

## 1. 目标

把“CGO / CMO 视角”从一句 prompt 文案，收成 `htops` 可执行、可测试、可持续演进的 analysis lens contract。

这次不改事实执行主链，不改 capability graph，不改 runtime 入口职责。

主链仍然是：

`Text -> Semantic Intent -> Query Plan -> Safe Execution -> Renderer`

本次只在 `Query Plan -> Renderer` 之间补强结构化分析角色。

---

## 2. 设计原则

### 2.1 角色不是人格提示词

不采用：

- “你是谷歌资深 15 年 CMO / CGO，请分析……”

采用：

- 结构化 analysis lens contract
- 明确 persona、framework、output contract、reasoning principles、forbidden claims

### 2.2 事实与判断分层

- 事实来自 serving / runtime owner modules
- 判断来自 analysis lens
- 表达来自 renderer output contract

AI 不负责：

- 定义指标口径
- 自由拼 SQL
- 绕过 capability graph
- 在缺证据时自由下结论

---

## 3. 当前落地内容

### 3.1 Registry

文件：

- `src/analysis-lens.ts`

当前已定义：

- `growth_exec_cgo_cmo_v1`
- `hq_growth_priority_v1`
- `store_growth_diagnosis_v1`
- `hq_growth_brief_v2`
- `store_growth_brief_v2`

### 3.2 Lens Contract 字段

当前 `QueryAnalysisLens` 已显式包含：

- `persona_id`
- `persona_label`
- `role_mission`
- `framework_id`
- `output_contract_id`
- `audience`
- `priority_dimensions`
- `signal_order`
- `section_labels`
- `reasoning_principles`
- `forbidden_claims`

### 3.3 当前角色定义

#### HQ lens

适用：

- `hq_portfolio`
- HQ / 多店 `advice`
- HQ / 多店 `risk`
- HQ / 多店 `anomaly`

输出结构：

1. 增长结论
2. 总部先盯的增长信号
3. 总部优先动作
4. 门店风险排序

#### Store lens

适用：

- 单店 `advice`
- 单店 `risk`
- 单店 `anomaly`

输出结构：

1. 增长结论
2. 这家店先看什么
3. 店长今天先做什么
4. 结论

---

## 4. 禁止越权判断

当前已显式写进 lens contract：

- 没有新客或渠道证据时，不下拉新质量结论
- 没有毛利或成本证据时，不下利润结论
- 数据不完整时，不把短期波动写成长期趋势
- 单店场景下，没有技师或排班证据时，不下执行效率结论

这些约束的作用不是“限制 AI 发挥”，而是提升可信度。

---

## 5. 当前收益

### 5.1 输出更像业务判断，而不是报表机器人

原来：

- `CGO/CMO指标优先级`
- `先看这4个经营信号`
- 单店开放分析仍然停留在 `风险与建议`

现在：

- `总部先盯的增长信号`
- `总部优先动作`
- `最后看拉新质量`
- 单店开放分析也已吃到：
  - `这家店先看什么`
  - `店长今天先做什么`
  - `结论`

### 5.2 后续优化不再散落

以后要继续补：

- `COO`
- `CFO`
- 不同 audience 的 output contract

都应该继续在 `analysis-lens.ts` registry 上收，不再散落到 prompt 和 renderer 文案里。

---

## 6. 挂载边界

允许修改：

- `src/analysis-lens.ts`
- `src/query-plan.ts`
- `src/query-engine-renderer.ts`

不允许借此扩张：

- `src/runtime.ts`
- capability graph 主路由
- safe execution 边界

---

## 7. 验收

本次已通过：

- `npx vitest run src/analysis-lens.test.ts src/query-plan.test.ts src/query-engine.test.ts`

验收点：

- HQ 分析问法命中结构化 lens
- 单店分析问法命中 store diagnosis lens
- 纯查数问题不带 executive lens
- HQ 输出吃到新的 section labels
- 单店开放分析输出吃到新的 section labels
- 输出不再出现 `CGO/CMO指标优先级`
