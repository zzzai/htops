# Semantic Recognition Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 强化 `htops` 前门语义识别，让“时间窗 + 每天/分天 + 标准经营字段白名单”这类高频经营问法稳定识别、稳定规划、稳定执行并稳定回复。

**Architecture:** 不改主骨架，继续沿 `Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action` 收口。实现只允许落在 owner modules：`query-semantics`、`query-intent`、`query-entry-adapter`、`query-plan`、`capability-graph`、`query-engine`、`conversation semantic state`、`semantic quality`。不加厚 `runtime.ts`，不引入第二套 ontology runtime，不让 AI fallback 成为主识别器。

**Tech Stack:** TypeScript, Vitest, PostgreSQL-backed owner modules, `src/query-semantics.ts`, `src/query-intent.ts`, `src/query-entry-adapter.ts`, `src/query-plan.ts`, `src/capability-graph.ts`, `src/query-engine.ts`, `src/metric-query.ts`, `src/app/conversation-semantic-state-service.ts`, `src/app/semantic-quality-service.ts`

---

### Task 1: 锁定“每天 / 分天 / 列出每一天”语义回归样本

**Files:**
- Modify: `src/query-semantics.test.ts`
- Modify: `src/query-intent.test.ts`
- Modify: `src/query-entry-adapter.test.ts`
- Modify: `src/route-eval.test.ts`

**Step 1: Write the failing tests**

- 增加样本，证明以下问法必须被识别成 `timeseries` 或 `breakdown`，而不是普通总量：
  - `义乌店近三天每天的客流量`
  - `义乌店近5天每天的营收`
  - `义乌店近5天每天的单数`
  - `义乌店近5天每天的储值`
  - `义乌店近7天每天的点钟数`
  - `义乌店近7天每天的加钟数`
  - `五店近7天每天营收对比`
- 增加 route-eval 样本，证明这些问法不再落入 generic fallback 或错误 summary route。

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run \
  src/query-semantics.test.ts \
  src/query-intent.test.ts \
  src/query-entry-adapter.test.ts \
  src/route-eval.test.ts
```

Expected:

- FAIL，因为当前系统对“时间窗 + 每天/分天”仍会把部分问法答成 summary 或直接 clarify。

**Step 3: Write minimal implementation**

- 暂不写实现，只确保失败样本完整覆盖：
  - 单店 timeseries
  - 多指标 timeseries
  - 五店 timeseries compare
  - 口语补充词如 `这几天每天情况`

**Step 4: Re-run to keep the red baseline recorded**

Run:

```bash
npm test -- --run \
  src/query-semantics.test.ts \
  src/query-intent.test.ts \
  src/query-entry-adapter.test.ts \
  src/route-eval.test.ts
```

Expected:

- 继续 FAIL，证明红灯样本已经锁住。

### Task 2: 在 `query-semantics` 中显式归一化 response shape 信号

**Files:**
- Modify: `src/query-semantics.ts`
- Modify: `src/query-semantics.test.ts`

**Step 1: Write the next failing test**

- 增加测试，证明语义层能稳定抽出：
  - `scope`
  - `time`
  - `metric`
  - `action`
  - `response_shape`
- 至少覆盖：
  - `每天`
  - `分天`
  - `列出每一天`
  - `趋势`
  - `对比`

**Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --run src/query-semantics.test.ts
```

Expected:

- FAIL，因为当前 `semanticSlots` 还没有把 `response_shape` 作为稳定显式槽位收口。

**Step 3: Write minimal implementation**

- 在 `src/query-semantics.ts` 中新增受限归一化槽位：
  - `responseShape: "scalar" | "timeseries" | "ranking" | "table" | "narrative"`
  - `timeGranularityHint: "day" | "week" | null`
- 把下列词面收为 deterministic 信号：
  - `每天`
  - `分天`
  - `列出每一天`
  - `逐天`
  - `趋势`
  - `近N天每天`
- 保持 `metric` 仍走白名单，不接受自由指标扩展。

**Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- --run src/query-semantics.test.ts
```

Expected:

- PASS，语义层开始稳定显式表达回答形态。

### Task 3: 在 `query-intent` 中保住时间窗与回答形态，不再塌缩成 summary

**Files:**
- Modify: `src/query-intent.ts`
- Modify: `src/query-intent.test.ts`
- Modify: `src/query-entry-adapter.ts`
- Modify: `src/query-entry-adapter.test.ts`

**Step 1: Write the failing tests**

- 增加测试，证明：
  - `近三天营收` 可保持 summary
  - `近三天每天营收` 必须变成 timeseries
  - `近7天每天点钟数/加钟数` 必须保住 breakdown/timeseries
  - `这几天义乌店每天情况` 在门店已明确时，不应退回 generic clarify

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/query-intent.test.ts src/query-entry-adapter.test.ts
```

Expected:

- FAIL，因为当前 intent 层还会把部分 “每天/分天” 口语问法压回普通 metric。

**Step 3: Write minimal implementation**

- 在 `src/query-intent.ts` 中把 `response_shape` / `time_grain` 带进正式 intent。
- 让 `query-entry-adapter` 对已补全门店/时间的高频口语补充词，优先进入明确 intent，而不是泛化 guidance。
- 保持 clarify 只在缺关键槽位时触发：
  - 缺门店
  - 缺时间
  - 缺指标
  - scope/object 明显混杂

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/query-intent.test.ts src/query-entry-adapter.test.ts
```

Expected:

- PASS，intent 层不再把 timeseries 误降级成 summary。

### Task 4: 在 capability graph / query plan 中显式区分 summary 与 timeseries

**Files:**
- Modify: `src/capability-graph.ts`
- Modify: `src/query-plan.ts`
- Modify: `src/query-engine.test.ts`
- Modify: `src/route-eval.test.ts`

**Step 1: Write the failing tests**

- 增加测试，证明：
  - `近3天每天营收` 产出的 plan 是 `time.mode=timeseries`
  - `response_shape` 是 `timeseries`
  - `五店近7天每天营收对比` 不会落成 `summary + peer compare`
  - `点钟数 / 加钟数` 分天问法能落在合法 capability contract

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/query-engine.test.ts src/route-eval.test.ts
```

Expected:

- FAIL，因为当前 plan 层对部分窗口指标问法仍缺少显式 response shape 约束。

**Step 3: Write minimal implementation**

- 在 `src/capability-graph.ts` 中补齐 capability contract：
  - 哪些 metric 支持 `summary`
  - 哪些 metric 支持 `timeseries`
  - 哪些 metric 支持 `breakdown`
- 在 `src/query-plan.ts` 中：
  - `每天 / 分天 / 逐天` 必须显式产出 `timeseries`
  - `多指标日序列` 必须显式产出 `breakdown` 或 `table`
  - 不允许 planner 靠 reply renderer 猜输出形态

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/query-engine.test.ts src/route-eval.test.ts
```

Expected:

- PASS，计划层开始把“回答形态”当成 capability contract 的一部分。

### Task 5: 在执行与回复层保住分天结果，不把明细说成总量

**Files:**
- Modify: `src/query-engine.ts`
- Modify: `src/metric-query.ts`
- Modify: `src/query-engine.test.ts`

**Step 1: Write the failing tests**

- 增加测试，证明：
  - `timeseries` 结果会返回按天明细
  - reply renderer 不会把分天结果压缩成总数
  - 缺部分日期数据时，输出仍然是“分天视图 + 缺口提示”，而不是 silent fallback

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/query-engine.test.ts
```

Expected:

- FAIL，因为当前执行或渲染层仍可能把明细聚合成 summary 文本。

**Step 3: Write minimal implementation**

- 在 `src/query-engine.ts` 中保留 plan 下发的 `response_shape`。
- 在 `src/metric-query.ts` 中明确分出：
  - summary metric paths
  - timeseries metric paths
  - multi-metric timeseries paths
- 回复文本严格跟随执行结果：
  - 有明细就输出明细
  - 有总计可附加，但不能替代明细
  - 缺字段就显式提示缺口

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/query-engine.test.ts
```

Expected:

- PASS，“每天/分天” 问法不再被答成总量。

### Task 6: 把 conversation semantic state 扩到最小补槽，不扩成自由推断

**Files:**
- Modify: `src/app/conversation-semantic-state-service.ts`
- Modify: `src/app/conversation-semantic-state-service.test.ts`
- Modify: `src/query-intent.ts`

**Step 1: Write the failing tests**

- 增加测试，证明：
  - 上一轮已明确门店，本轮只补 `近7天每天的营收` 时，可以安全 carry
  - topic switch 后不会错误继承旧门店/旧指标
  - 只补 `昨天 / 近7天 / 近30天` 这类纯时间槽位时，系统能做受控补槽

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/app/conversation-semantic-state-service.test.ts src/query-intent.test.ts
```

Expected:

- FAIL，因为当前多轮 carry 规则对 “response shape + time window” 还不够稳。

**Step 3: Write minimal implementation**

- 只允许 carry 这些槽位：
  - store
  - time
  - metric
  - response_shape
- topic switch 出现时必须清空旧槽位：
  - 明显新门店
  - 明显新对象
  - 明显新动作
- 不做跨对象自由联想，不做 AI 推测式补全。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/app/conversation-semantic-state-service.test.ts src/query-intent.test.ts
```

Expected:

- PASS，多轮补槽稳定，但边界仍保持 deterministic。

### Task 7: 把 semantic quality taxonomy 拆成“识别错 / 形态错 / 回复错”

**Files:**
- Modify: `src/app/semantic-quality-service.ts`
- Modify: `src/app/semantic-quality-service.test.ts`
- Modify: `src/route-eval.test.ts`

**Step 1: Write the failing tests**

- 增加测试，证明质量层可以记录：
  - `semantic_parse_gap`
  - `clarify_gap`
  - `capability_mapping_gap`
  - `response_shape_gap`
  - `reply_render_gap`

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/app/semantic-quality-service.test.ts src/route-eval.test.ts
```

Expected:

- FAIL，因为当前失败分类还不足以区分“识别错”和“回答形态错”。

**Step 3: Write minimal implementation**

- 在 `src/app/semantic-quality-service.ts` 中新增细化分类映射。
- route eval 失败时优先记录到对应 taxonomy，而不是只记 generic unresolved。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/app/semantic-quality-service.test.ts src/route-eval.test.ts
```

Expected:

- PASS，质量闭环能指向具体 owner module。

### Task 8: 跑 focused regression 并验证第一刀体感收益

**Files:**
- No code changes expected

**Step 1: Run focused regression**

Run:

```bash
npm test -- --run \
  src/query-semantics.test.ts \
  src/query-intent.test.ts \
  src/query-entry-adapter.test.ts \
  src/route-eval.test.ts \
  src/app/conversation-semantic-state-service.test.ts \
  src/query-engine.test.ts \
  src/app/semantic-quality-service.test.ts
```

Expected:

- PASS，第一刀覆盖的 owner modules 全部回归通过。

**Step 2: Run local semantic smoke**

Run:

```bash
node --import tsx src/main.ts hetang query "义乌店近三天每天的客流量"
node --import tsx src/main.ts hetang query "义乌店近5天每天的营收"
node --import tsx src/main.ts hetang query "五店近7天每天营收对比"
```

Expected:

- 输出形态与问题一致：
  - 要分天，就有分天
  - 要对比，就有分天对比
  - 不再把“每天”答成“总量”

**Step 3: Record post-cut quality checks**

- 对比切前切后：
  - route-eval 命中率
  - clarify 率
  - ai_fallback 使用率
  - entry_unresolved
  - response_shape_gap

Expected:

- 第一刀至少在 `timeseries / breakdown` 高频问法上给出明显体感提升。
