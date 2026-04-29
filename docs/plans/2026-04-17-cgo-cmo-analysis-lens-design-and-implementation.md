# CGO/CMO Analysis Lens Design And Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first-class CGO/CMO analysis lens to `htops` so analysis-style asks are routed through a structured executive perspective instead of ad-hoc prompt wording.

**Architecture:** Keep `capability graph -> query plan -> safe execution -> renderer` as the only truth path. Introduce one small analysis-lens registry plus one resolver that annotates analysis-style `QueryPlan`s, then let existing owner renderers consume that lens to produce stable executive-style answers without expanding `runtime.ts` or creating a parallel ontology system.

**Tech Stack:** TypeScript, Vitest, existing `query-intent` / `query-plan` / `query-engine-renderer` / `store-query` owner modules.

---

## 1. Business Insight

当前项目已经能回答很多经营问题，但“分析视角”仍然是隐式的：

- 同一句分析问题，有时像运营助理，有时像报表机器人。
- CGO/CMO 视角没有被结构化表达，后续很容易重新散落到 prompt、文案和局部规则里。

要解决的不是“让 AI 扮演一个高管”，而是让系统稳定地按高管分析框架回答：

- 什么时候进入分析态
- 进入后用什么视角
- 这个视角优先看哪些指标
- 输出必须长什么样

## 2. Design Decision

### Option A. Prompt-only persona

做法：

- 在 system / renderer prompt 里写一段“你是谷歌资深 15 年 CGO / CMO”

优点：

- 开发快
- 表面改动少

缺点：

- 无法稳定触发
- 无法被测试
- 容易和当前 deterministic query path 形成双轨

结论：

- 不采用

### Option B. Structured analysis lens on query plan

做法：

- 新增 persona registry 和 framework registry
- `buildQueryPlanFromIntent()` 为分析态问题补 `analysis` 字段
- renderer 按 `analysis lens` 决定段落、优先级和数据不足提示

优点：

- 不绕过 capability graph / safe execution
- 可测试、可扩展、可逐步覆盖更多问法
- 不需要在 `runtime.ts` 新增业务职责

缺点：

- 需要补一层字段和测试
- 第一版不会一次覆盖所有分析输出

结论：

- 采用

## 3. First-Version Scope

第一版只做三件事：

1. 新增 `analysis lens` registry 与 resolver
2. 在 `QueryPlan` 上显式暴露 `analysis` 字段
3. 让 HQ 开放分析回答真实吃到这层 lens

明确不做：

- 不引入第二套 ontology runtime
- 不让 AI 直接决定 capability graph
- 不把 persona 强行套到纯查数问答
- 不重构 async analysis sidecar

## 4. Data Contract

### 4.1 Persona

第一版只定义一个受控 persona：

```ts
type AnalysisPersonaId = "growth_exec_cgo_cmo_v1";
```

含义：

- 面向总部与增长判断
- 优先看留存、转化、单客价值、会员资产质量
- 输出强调结论、证据、优先动作

### 4.2 Framework

第一版先定义两个 framework：

```ts
type AnalysisFrameworkId =
  | "hq_growth_priority_v1"
  | "store_growth_diagnosis_v1";
```

### 4.3 Query Plan Extension

在 `QueryPlan` 中增加：

```ts
analysis?: {
  mode: "fact_only" | "executive_analysis";
  persona_id: AnalysisPersonaId;
  framework_id: AnalysisFrameworkId;
  audience: "hq" | "store";
  priority_dimensions: string[];
  preferred_sections: string[];
};
```

## 5. Invocation Rules

### 5.1 进入 executive analysis 的条件

第一版只对分析态问题触发：

- `hq_portfolio`
- `risk`
- `advice`
- `anomaly`

并按 scope 选择 framework：

- HQ / 多店：`hq_growth_priority_v1`
- 单店：`store_growth_diagnosis_v1`

### 5.2 不触发的情况

- 纯查数
- breakdown / compare / ranking 但用户只是要结果
- 任何 clarification 场景

## 6. Rendering Contract

第一版 renderer 消费 lens 时，必须满足：

1. 明确“增长结论”
2. 明确“先看什么指标”
3. 明确“当前数据能判断什么、不能判断什么”
4. 明确“优先动作”

对 HQ 开放分析回答，第一版输出结构收敛为：

1. 增长结论
2. 核心指标优先级
3. 优先动作
4. 风险排序

## 7. Module Boundaries

### Create

- `src/analysis-lens.ts`

职责：

- persona / framework registry
- `resolveQueryAnalysisLens()`

### Modify

- `src/query-plan.ts`
  - 在 owner plan 层附着 `analysis`
- `src/query-engine-renderer.ts`
  - 让 HQ 开放分析输出吃到 lens
- `src/query-plan.test.ts`
  - 冻结 lens 路由契约
- `src/query-engine.test.ts`
  - 冻结 HQ 分析输出契约

### Not Modify

- `src/runtime.ts`
- async analysis orchestrator 主逻辑
- query capability graph selection 主逻辑

## 8. Implementation Tasks

### Task 1: Freeze analysis lens contracts in tests

**Files:**

- Create: `src/analysis-lens.test.ts`
- Modify: `src/query-plan.test.ts`
- Modify: `src/query-engine.test.ts`

**Intent:**

- prove analysis asks get a structured lens
- prove fact-only asks stay fact-only
- prove HQ focus output consumes the lens

### Task 2: Implement analysis lens registry

**Files:**

- Create: `src/analysis-lens.ts`

**Intent:**

- define persona ids / framework ids
- expose `resolveQueryAnalysisLens()`
- keep logic small and deterministic

### Task 3: Attach lens to query plans

**Files:**

- Modify: `src/query-plan.ts`

**Intent:**

- `buildQueryPlanFromIntent()` should annotate analysis-style asks
- avoid touching execution routing

### Task 4: Apply lens in HQ renderer

**Files:**

- Modify: `src/query-engine-renderer.ts`

**Intent:**

- make HQ open analysis output look like an executive growth diagnosis
- keep “哪家最危险” and pure ranking asks stable

### Task 5: Verify and restart serving services

**Files:**

- None

**Intent:**

- run focused tests
- run related regressions
- run CLI smoke
- restart `htops-bridge.service` and `htops-query-api.service`

## 9. Acceptance Criteria

完成后必须满足：

1. `QueryPlan` 对分析态问题带 `analysis`
2. 纯查数问题不带 executive lens
3. `五店近7天重点看什么` 的输出出现明确的增长视角段落
4. `五店近7天哪家店最危险` 仍保持窄口径
5. 所有改动集中在 owner modules

## 10. Verification Commands

最少执行：

- `npx vitest run src/analysis-lens.test.ts src/query-plan.test.ts src/query-engine.test.ts`
- `npx vitest run src/query-engine.test.ts src/inbound-bridge-regression.test.ts src/query-entry-adapter.test.ts src/semantic-intent.test.ts src/query-intent.test.ts`
- `pnpm cli -- hetang query "五店近7天重点看什么" --user ZhangZhen`
- `pnpm cli -- hetang query "五店近7天哪家店最危险" --user ZhangZhen`

服务发布：

- `systemctl restart htops-bridge.service`
- `systemctl restart htops-query-api.service`
