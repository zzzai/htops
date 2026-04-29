# Analysis Lens Role Contract V3

日期：2026-04-18
状态：done
范围：single-store analysis role routing

---

## 1. 本次新增内容

在既有 `CGO/CMO` 增长经营视角之外，补齐两档新的单店分析角色：

- `operations_exec_coo_v1`
- `profit_exec_cfo_v1`

本次仍然不改事实执行主链，不改 capability graph，不往 `runtime.ts` 塞业务职责。

主链仍然是：

`Text -> Semantic Intent -> Query Plan -> Safe Execution -> Renderer`

本次只加强：

- `Semantic Intent` 对“开放分析问法”的安全升级
- `Query Plan -> Renderer` 之间的 analysis lens contract

---

## 2. 为什么要补这一层

之前已经把开放分析从“硬编码文案”升级成了结构化 `CGO/CMO` lens。

但还存在一个明显缺口：

- 运营效率类问法
- 利润/保本/现金流类问法

仍然会共用“增长视角”或者直接掉回“多指标查数”。

这会导致两个问题：

1. 用户明明在问“该先盯什么”，系统却只回“指标查询”
2. 即便进入分析输出，结论也容易带着错误的增长口径

---

## 3. 本次落地的角色

### 3.1 COO 运营履约视角

注册项：

- `persona_id`: `operations_exec_coo_v1`
- `framework_id`: `store_operations_diagnosis_v1`
- `output_contract_id`: `store_operations_brief_v1`

适用场景：

- 单店开放分析问法
- 且文本/指标明显偏向：
  - 点钟率
  - 加钟率
  - 钟效
  - 上座率 / 翻房率
  - 排班 / 在岗 / 活跃技师
  - 承接 / 候钟 / 晚场有没有接住

输出结构：

1. 运营结论
2. 这家店先盯的履约信号
3. 店长今天先调整什么
4. 结论

核心原则：

- 先看承接和履约，再看结果数据
- 建议必须落到班次、排班或现场动作
- 没有等待、产能或排班证据时，不伪造现场原因

### 3.2 CFO 利润经营视角

注册项：

- `persona_id`: `profit_exec_cfo_v1`
- `framework_id`: `store_profit_diagnosis_v1`
- `output_contract_id`: `store_profit_brief_v1`

适用场景：

- 单店开放分析问法
- 且文本/指标明显偏向：
  - 毛利率
  - 净利率
  - 保本营收
  - 现金流 / 耗卡
  - 储值寿命
  - 续费压力

输出结构：

1. 利润结论
2. 这家店先盯的利润信号
3. 店长今天先收哪一口利润
4. 结论

核心原则：

- 先看利润空间，再看保本安全垫
- 不把流水增长直接等同于利润改善
- 没有毛利/净利/成本证据时，不下利润结论

---

## 4. 安全升级规则

本次补了一个非常窄的意图升级规则：

- 如果问法满足：
  - 单店
  - 窗口期
  - `重点看什么 / 该看什么 / 看什么指标 / 重点抓什么 / 该抓什么`
- 即使文本里带了多个明确指标
- 也允许从 `metric` 升级为开放分析问法

但只在一种情况下覆盖原路由：

- 原路由是 `metric`

不会覆盖：

- ranking
- compare
- risk
- anomaly
- report

这样做的目的，是只修“开放分析被误判成查数”这一个缺口，不扩大误伤面。

---

## 5. 当前边界

本次只落在单店分析链路。

HQ / 多店仍保持：

- `CGO/CMO` 增长经营视角

原因不是不想做，而是当前 HQ serving 面向开放分析时，稳定暴露的字段仍更适合增长/风险总览，不适合硬做总部 `COO / CFO` 伪分析。

也就是说：

- 单店：已经具备 `CGO/CMO + COO + CFO`
- HQ：当前仍保留 `CGO/CMO`

---

## 6. 验收命令

本次通过：

```bash
npx vitest run src/query-intent.test.ts src/analysis-lens.test.ts src/query-plan.test.ts src/query-engine.test.ts
```

覆盖点：

- 单店开放运营问法会进入 `COO lens`
- 单店开放利润问法会进入 `CFO lens`
- 开放问法不会再错误退化成 `指标查询`
- `CGO/CMO` 原有增长分析输出不回退
- 问法升级仅覆盖安全范围，不破坏既有主链

---

## 7. 下一步建议

下一阶段继续沿这条线收，不要回到 prompt 文案堆砌：

1. 把 `HQ CFO / HQ COO` 是否值得落地，先建立字段充分性清单
2. 把 `analysis lens` 挂到 semantic quality failure backlog
3. 把 conversation semantic state 对“老板式口语 / 复合问法 / topic switch”的延续，和 lens 选择联动起来
