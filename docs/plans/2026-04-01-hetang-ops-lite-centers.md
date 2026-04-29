# Hetang Ops Lite Centers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `extensions/hetang-ops` 内补齐 `Action Center lite`、`Learning Engine lite`、`Control Tower lite` 三块经营闭环能力，并保持现有企微命令、日报、问答和同步链路不被破坏。

**Architecture:** 所有新增能力都落在现有插件内，不新建独立服务。`Action Center lite` 负责承接经营动作单和状态流转，`Learning Engine lite` 直接复用动作单生命周期沉淀采纳和效果，`Control Tower lite` 以全局/门店两级策略覆盖现有问答配额、日报预警阈值和通知开关。

**Tech Stack:** TypeScript, Vitest, PostgreSQL (`pg` + `pg-mem`), existing `HetangOpsRuntime` / `HetangOpsStore`.

---

### Task 1: Define lite center contracts

**Files:**

- Modify: `extensions/hetang-ops/src/types.ts`
- Test: `extensions/hetang-ops/src/access.test.ts`

**Steps:**

1. 写失败测试，覆盖新命令动作类型与配额覆盖输入。
2. 运行对应测试，确认当前不支持。
3. 在 `types.ts` 和 `access.ts` 增加动作单、学习摘要、策略覆盖的最小类型。
4. 再跑测试，确认通过。

### Task 2: Add Action Center lite persistence

**Files:**

- Modify: `extensions/hetang-ops/src/store.ts`
- Test: `extensions/hetang-ops/src/store.test.ts`

**Steps:**

1. 先补失败测试，覆盖动作单创建、流转、门店过滤和学习摘要统计。
2. 运行测试，确认 schema/方法缺失导致失败。
3. 在 `store.ts` 增加动作单表、策略表及对应 CRUD。
4. 再跑测试，确认通过。

### Task 3: Wire runtime helpers

**Files:**

- Modify: `extensions/hetang-ops/src/runtime.ts`
- Test: `extensions/hetang-ops/src/runtime.test.ts`

**Steps:**

1. 先补失败测试，覆盖动作单读写、学习摘要、策略读取以及配额/阈值覆盖生效。
2. 运行测试，确认失败。
3. 在 `runtime.ts` 增加 lite center 读写方法，并在 `buildReport` / `sendReport` 中使用策略覆盖。
4. 再跑测试，确认通过。

### Task 4: Expose `/hetang` command surface

**Files:**

- Modify: `extensions/hetang-ops/src/access.ts`
- Modify: `extensions/hetang-ops/src/command.ts`
- Test: `extensions/hetang-ops/src/command.test.ts`

**Steps:**

1. 先补失败测试，覆盖 `/hetang action`、`/hetang learning`、`/hetang tower` 的最小命令闭环。
2. 运行测试，确认失败。
3. 实现命令解析、权限控制、审计和文本输出。
4. 再跑测试，确认通过。

### Task 5: Verify plugin health

**Files:**

- Test: `extensions/hetang-ops/src/*.test.ts`

**Steps:**

1. 跑新增相关定向测试。
2. 跑 `extensions/hetang-ops` 全量测试。
3. 跑 `pnpm build`。
4. 重启网关并做一次 `openclaw channels status --probe`。
