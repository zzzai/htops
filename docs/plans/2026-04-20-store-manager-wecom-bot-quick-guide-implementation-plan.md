# Store Manager WeCom Bot Quick Guide Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增一份面向店长的企业微信 Hermes-htops 问数速查手册，并把入口挂到现有店长报表教程中。

**Architecture:** 不改运行时代码，只补文档层。主文档单独落在 `docs/` 下，聚焦“店长在企微里怎么问”；现有店长报表教程只保留入口，避免重复写两套内容。命令示例严格以当前 `src/command.ts` 和相关测试覆盖的真实能力为准。

**Tech Stack:** Markdown, existing Hetang command surface, current troubleshooting and command tests

---

### Task 1: 归拢当前真实问法边界

**Files:**
- Read: `src/command.ts`
- Read: `src/command.test.ts`
- Read: `docs/plans/2026-03-31-hetang-ops-troubleshooting.md`

**Step 1: Confirm the stable usage rules**

- 记录当前真实边界：
  - `/hetang report` 是最稳入口
  - `/hetang query` 适合原因/建议
  - `/hetang reactivation summary|tasks|update` 已可用
  - 单店长可省门店名
  - 多店权限必须显式带门店
  - 群聊自然语言要 `@机器人`

**Step 2: Self-check**

- 确认教程不会写出当前还没稳定支持的问法。

### Task 2: 新增店长企微 Bot 速查手册

**Files:**
- Add: `docs/store-manager-wecom-bot-quick-guide.md`

**Step 1: Write the guide**

- 文档结构必须包含：
  - 什么时候用
  - 最稳的问法
  - 6 类高频问题示例
  - 查完后的动作模板
  - 常见错误问法

**Step 2: Ensure examples are operator-friendly**

- 每类问题至少给出：
  - 1 条推荐发法
  - 1 条不推荐发法
  - 1 句“什么时候用”

### Task 3: 在现有店长指南补入口

**Files:**
- Modify: `docs/store-manager-reporting-guide.md`

**Step 1: Add a pointer**

- 在文档开头补一段：
  - 如果是“怎么看日报/周报/周图”，看当前文档
  - 如果是“在企微里怎么问 Hermes-htops”，看新速查手册

### Task 4: 做最终一致性检查

**Files:**
- Verify: `docs/store-manager-wecom-bot-quick-guide.md`
- Verify: `docs/store-manager-reporting-guide.md`

**Step 1: Verify wording**

- 确认：
  - 文档没有技术术语堆砌
  - 文档没有写出不存在的命令
  - 文档没有和现有店长报表教程冲突

**Step 2: Final check**

Run:
- `rg -n \"store-manager-wecom-bot-quick-guide|/hetang report|/hetang query|/hetang reactivation\" docs/store-manager-wecom-bot-quick-guide.md docs/store-manager-reporting-guide.md`

Expected:

- 新文档存在
- 关键命令示例完整
- 现有店长教程已挂入口
