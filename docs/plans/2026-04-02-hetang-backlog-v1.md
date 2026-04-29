# Hetang Ops Backlog V1

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `extensions/hetang-ops` 当前最关键的经营闭环缺口收束成一版可执行待办，并优先补上能直接提升可用性的 `P0`。

**Architecture:** 继续沿用单插件架构，不拆新服务。`P0` 聚焦深度分析任务的可管理、可重试、可复用，避免系统重复计算和“任务发出去就像扔进黑洞”；`P1` 把分析结果真正接入动作闭环与控制面；`P2` 再做学习优化和更完整的多 Agent 协作。

**Tech Stack:** TypeScript, Vitest, PostgreSQL (`pg` + `pg-mem`), existing `HetangOpsRuntime` / `HetangOpsStore` / `inbound` command flow.

---

## Current State Snapshot

- 已有异步深度分析入口：自然语言复盘可入队、调起 CrewAI sidecar、结果可回传。
- 已有 lite 能力底座：`Action Center`、`Learning Engine lite`、`Control Tower lite` 已有基础结构。
- 当前主要短板不在“有没有模块”，而在“模块能不能真被业务拿来用”。

一句人话总结：
系统已经会思考了，但还不太会排队、不会报进度，也不太会记住“这题我刚做过”。

## P0：先把系统从“会做事”补到“能上线用”

### P0-1 分析任务命令面板

**目标：** 补齐 `/hetang analysis` 管理命令，让 HQ / 店长能看到任务、查状态、手动重试。

**执行任务：**

- 新增 `/hetang analysis list [门店] [status]`
- 新增 `/hetang analysis status [jobId]`
- 新增 `/hetang analysis retry [jobId]`
- 更新帮助文案与访问控制
- 为命令输出补充清晰的人话文案

**涉及文件：**

- `extensions/hetang-ops/src/access.ts`
- `extensions/hetang-ops/src/command.ts`
- `extensions/hetang-ops/src/command.test.ts`

### P0-2 同时间窗分析去重与结果复用

**目标：** 同一门店、同一时间窗的深度分析不要反复算；已经有结果的，优先复用。

**执行任务：**

- 在 PostgreSQL 中增加“可复用任务查询”能力
- 新请求命中 `pending/running` 任务时直接复用既有 job
- 新请求命中 `completed` 任务时直接复用既有结果
- 保留 `failed` 任务，改走显式 `retry`
- 更新入站话术，避免继续承诺“不一定会来的自动回信”

**涉及文件：**

- `extensions/hetang-ops/src/store.ts`
- `extensions/hetang-ops/src/runtime.ts`
- `extensions/hetang-ops/src/inbound.ts`
- `extensions/hetang-ops/src/store.test.ts`
- `extensions/hetang-ops/src/runtime.test.ts`
- `extensions/hetang-ops/src/inbound.test.ts`

### P0-3 失败任务可重试

**目标：** 让失败分析不再只能“删库重来”，而是可控地重新进入队列。

**执行任务：**

- 增加 `failed -> pending` 的重试状态流转
- 清理失败结果字段，保留尝试次数
- 在命令面透出重试结果
- 为重试场景补齐 store/runtime 测试

**涉及文件：**

- `extensions/hetang-ops/src/store.ts`
- `extensions/hetang-ops/src/runtime.ts`
- `extensions/hetang-ops/src/command.ts`
- `extensions/hetang-ops/src/store.test.ts`
- `extensions/hetang-ops/src/runtime.test.ts`

## P1：把“分析”真正接到经营闭环上

### P1-1 分析结果自动生成动作单

**目标：** 深度分析不只会说，还要能自动落到 `Action Center`。

**执行任务：**

- 从分析结果中抽取建议项
- 按类目、优先级、来源生成动作单
- 增加 `analysis.autoCreateActions` 控制开关
- 避免同一分析结果重复造单

### P1-2 Control Tower lite 扩容

**目标：** 让控制台不仅能控配额和阈值，还能控分析策略。

**执行任务：**

- 新增 `analysis.reviewMode`
- 新增 `analysis.autoCreateActions`
- 新增 `analysis.retryEnabled`
- 新增 `analysis.notifyOnFailure`

### P1-3 分析结果基础埋点

**目标：** 给后续 Learning 留下“能学”的数据，不再只靠回忆和缘分。

**执行任务：**

- 记录分析任务数量、成功率、失败率、平均耗时
- 记录人工重试次数
- 记录动作单转化率

## P2：把项目从“能跑”推向“会进化”

### P2-1 Learning Engine 从摘要进化到反馈优化

**目标：** 不只统计采纳率，还要能反向影响建议权重。

**执行任务：**

- 建立建议类型与效果分数的映射
- 标记高采纳/低采纳模式
- 为后续提示词优化提供反馈数据

### P2-2 CrewAI 角色化增强

**目标：** 从“接了 CrewAI”升级为“真的有分工的多 Agent”。

**执行任务：**

- 明确 Analyst / Operator / Advisor 等角色职责
- 把 `review_mode` 从 `direct` 扩展到可选多角色协作
- 优化 sidecar prompt 与输出结构

### P2-3 多会话回推与结果订阅

**目标：** 同一分析任务被多个会话请求时，结果可以按订阅者 fan-out 回传。

**执行任务：**

- 增加分析任务订阅关系表
- 结果完成后按订阅者逐一投递
- 为后续 Redis/预计算/语义缓存留接口，但暂不提前上复杂度

## Execution Order

1. 先做 `P0-1` 命令面板，不然任务复用了也没人看得见。
2. 再做 `P0-2` 去重与复用，不然系统会勤奋地重复劳动。
3. 最后做 `P0-3` 重试闭环，不然失败任务仍然像“经营系统里的未解之谜”。

## Done Definition for P0

- `/hetang analysis list|status|retry` 可用
- 同时间窗分析请求不会重复入队
- 已完成分析可被直接复用
- 失败分析可重新进入队列
- 入站提示文案与真实行为一致
- 定向测试、`extensions/hetang-ops` 全量测试、`pnpm build` 全部通过
