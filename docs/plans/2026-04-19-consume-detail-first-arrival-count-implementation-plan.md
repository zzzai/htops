# Consume-Detail-First Arrival Count Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add consume-detail-first shadow metrics for settlement customer count and arrival-count estimation, with tech-up-clock used only as a bounded supplement for weak consume-detail evidence.

**Architecture:** Introduce a dedicated owner module for arrival-count derivation, keep `metrics.ts` as the integration point, and ship the new metrics in shadow mode before any change to the existing `customerCount` user-facing semantics.

**Tech Stack:** TypeScript, Vitest, existing consume-bill identity parsing, tech-up-clock raw field parsing, daily metrics pipeline.

---

### Task 1: 抽出 consume-detail-first 人数推导 owner module

**Files:**
- Add: `src/customer-arrival-metrics.ts`
- Add: `src/customer-arrival-metrics.test.ts`

**Step 1: Write the failing test**

覆盖以下场景：

- `Infos` 两位顾客 => `settlementCustomerCount = 2`
- `Infos` 单位顾客 => `settlementCustomerCount = 1`
- `Infos` 缺失但 `CardNo / MemberPhone` 可识别 => `settlementCustomerCount = 1`
- `Infos` 缺失且无稳定身份 => 标记为 weak-evidence settlement

**Step 2: Run test to verify it fails**

Run: `npm test -- src/customer-arrival-metrics.test.ts`

Expected:

- 新增测试先失败，因为 owner module 尚不存在

**Step 3: Write minimal implementation**

在 `src/customer-arrival-metrics.ts` 中提供：

- 单据级顾客人数解析
- 强/弱证据判定
- 当日 `settlementCustomerCount` 汇总
- `arrivalEvidenceCoverage` 计算

**Step 4: Run test to verify it passes**

Run: `npm test -- src/customer-arrival-metrics.test.ts`

Expected:

- consume-detail-first 基础行为通过

### Task 2: 引入 tech-up-clock 补洞逻辑

**Files:**
- Modify: `src/customer-arrival-metrics.ts`
- Modify: `src/customer-arrival-metrics.test.ts`

**Step 1: Write the failing test**

新增以下场景：

- 某结算单消费明细为 weak evidence，但首次非加钟主项上钟有 2 位技师 => `arrivalCustomerCountEstimated` 补到 2
- 同一结算单存在加钟 => 不新增人数
- 同一结算单只有采耳/刮痧等小项上钟 => 不作为新增人数
- 消费明细已有强证据时，上钟数据不能覆盖它

**Step 2: Run test to verify it fails**

Run: `npm test -- src/customer-arrival-metrics.test.ts`

Expected:

- 新增补洞测试失败

**Step 3: Write minimal implementation**

实现：

- `settleNo -> first primary non-add clock count` 映射
- 小项识别：先基于 `ItemCategory + ItemName` 规则
- 只补 weak settlements，不重写 strong settlements

**Step 4: Run test to verify it passes**

Run: `npm test -- src/customer-arrival-metrics.test.ts`

Expected:

- consume-detail 主逻辑与 tech 补洞逻辑都通过

### Task 3: 把 shadow metrics 接到 daily metrics pipeline

**Files:**
- Modify: `src/types.ts`
- Modify: `src/metrics.ts`
- Modify: `src/metrics-customer-count.test.ts`
- Modify: `src/report.test.ts`

**Step 1: Write the failing test**

新增断言：

- `DailyStoreMetrics` 输出包含：
  - `settlementCustomerCount`
  - `arrivalCustomerCountEstimated`
  - `arrivalEvidenceCoverage`
- `customerCount` 现阶段保持兼容，不直接被新算法替换

**Step 2: Run test to verify it fails**

Run: `npm test -- src/metrics-customer-count.test.ts src/report.test.ts`

Expected:

- 新字段未接线，测试先失败

**Step 3: Write minimal implementation**

- 在 `metrics.ts` 中调用新 owner module
- 将 shadow metrics 写入 `DailyStoreMetrics`
- 现有 `customerCount` 继续保留原行为，避免直接切口径

**Step 4: Run test to verify it passes**

Run: `npm test -- src/metrics-customer-count.test.ts src/report.test.ts`

Expected:

- 新增 shadow metrics 已接入
- 老口径不回归

### Task 4: 暴露显式查询入口，不替换现有“客流”默认语义

**Files:**
- Modify: `src/metric-query.ts`
- Modify: `src/metric-query.test.ts`
- Modify: `src/query-engine-renderer.ts`
- Modify: `src/query-engine.test.ts`

**Step 1: Write the failing test**

新增查询覆盖：

- “结算顾客人数”
- “承接到店人数估算”

同时确认：

- “客流 / 客流量 / 到店人数” 暂时仍指向现有 `customerCount`

**Step 2: Run test to verify it fails**

Run: `npm test -- src/metric-query.test.ts src/query-engine.test.ts`

Expected:

- 新指标尚未注册，测试失败

**Step 3: Write minimal implementation**

- 在 `metric-query.ts` 新增显式 metric key 与 alias
- renderer 输出新指标时要注明其口径：
  - 结算顾客人数
  - 承接到店人数估算

**Step 4: Run test to verify it passes**

Run: `npm test -- src/metric-query.test.ts src/query-engine.test.ts`

Expected:

- 新口径可被显式查询
- 旧“客流”默认问法不被悄悄改口径

### Task 5: 文档与对照验证

**Files:**
- Modify: `docs/plans/2026-03-31-hetang-ops-data-and-metrics-dictionary.md`
- Modify: `docs/plans/2026-04-19-consume-detail-first-arrival-count-design.md`
- Modify: `docs/plans/2026-04-19-consume-detail-first-arrival-count-implementation-plan.md`

**Step 1: 回写指标字典**

- 为 shadow metrics 增加正式定义
- 标注当前 `customerCount` 与新口径并存

**Step 2: 运行定向验证**

Run:

- `npm test -- src/customer-arrival-metrics.test.ts`
- `npm test -- src/metrics-customer-count.test.ts src/report.test.ts`
- `npm test -- src/metric-query.test.ts src/query-engine.test.ts`

**Step 3: 运行聚合回归**

Run:

- `npm test -- src/customer-arrival-metrics.test.ts src/metrics-customer-count.test.ts src/report.test.ts src/metric-query.test.ts src/query-engine.test.ts`

**Step 4: 汇报结果**

- 说明 shadow metrics 是否已落地
- 说明是否仍保持 `customerCount` 兼容
- 给出下一阶段是否切换正式口径的建议
