# Hetang Manager Customer Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将顾客画像重排成店长版经营画像，突出结论、风险和今日动作。

**Architecture:** 保留现有顾客画像的数据拉取与打分逻辑，只替换 `summary` 路径的文案编排层。专项偏好问法继续复用原有短输出，避免影响现有查询能力。

**Tech Stack:** TypeScript, Vitest, Hetang query engine/customer profile pipeline

---

### Task 1: 锁定店长版输出结构

**Files:**
- Modify: `extensions/hetang-ops/src/query-engine.test.ts`

**Step 1: Write the failing test**

- 将顾客画像相关断言改为：
  - 包含 `一句话判断`、`当前状态`、`顾客价值`、`偏好与习惯`、`风险与机会`、`今日先抓`
  - 不再依赖 `客户价值分析`、`支付结构诊断`、`店长动作建议` 这些旧区块标题
  - 对无附加明细案例，断言不出现 `暂无可识别明细`

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts -t "客户画像"`

**Step 3: Write minimal implementation**

- 暂不实现，仅确认新结构测试真的失败在旧输出。

**Step 4: Run test to verify it fails as expected**

- 观察失败点集中在顾客画像标题和区块结构。

### Task 2: 重写顾客画像 summary 渲染

**Files:**
- Modify: `extensions/hetang-ops/src/customer-profile.ts`

**Step 1: Implement section helpers**

- 新增店长版 `summary` 渲染 helper：
  - 一句话判断
  - 顾客价值
  - 偏好与习惯
  - 风险与机会
  - 今日先抓

**Step 2: Preserve existing semantics**

- 继续复用现有：
  - 顾客等级
  - 生命周期
  - 经营分层 / 标签 / actionPriority
  - 沉默风险
  - 复购概率
  - 团购承接快照

**Step 3: Hide low-signal empty rows**

- 在 `summary` 输出里，对茶饮 / 餐食 / 副项 / 时段 / 日期偏好等空值整行隐藏。
- 保留专项问法的短输出逻辑不变。

### Task 3: 验证查询链

**Files:**
- Test: `extensions/hetang-ops/src/query-engine.test.ts`
- Optional check: `extensions/hetang-ops/src/inbound.test.ts`

**Step 1: Run targeted tests**

Run: `pnpm test -- extensions/hetang-ops/src/query-engine.test.ts`

**Step 2: Run adjacent inbound coverage if needed**

Run: `pnpm test -- extensions/hetang-ops/src/inbound.test.ts`

**Step 3: Run build**

Run: `pnpm build`

### Task 4: Final verification

**Files:**
- Review only

**Step 1: Confirm the final customer profile now reads like a store-manager operating brief**

- 结论前置
- 风险可读
- 动作不空泛
- 无 `N/A`

**Step 2: Summarize user-visible changes**

- 说明只改了顾客画像 summary，不影响专项偏好问法。
