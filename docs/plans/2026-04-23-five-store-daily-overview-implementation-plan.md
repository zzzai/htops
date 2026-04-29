# 5店昨日经营总览（店长共看版）Implementation Checklist

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `htops` 增加“5店昨日经营总览（店长共看版）”，在单店日报全部发送完成后，基于前一营业日稳定事实发送一份横向对比、差距拆解和今日动作共享战报。

**Architecture:** 继续复用 `DailyStoreReport.metrics + reporting-service + sync-orchestrator + shared delivery` 路线，不新建第二套报表 truth source。先补 deterministic renderer，再补 shared delivery 和调度等待规则；第一版不让 AI 主导差距判断，也不把新职责堆进 `src/runtime.ts`。

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, current `src/app/reporting-service.ts`, `src/sync-orchestrator.ts`, `src/schedule.ts`, `src/types.ts`, `src/report.ts`

**Status Update (2026-04-23):** Task 1-6 已完成最小闭环实现，并已补齐 `preview -> pending_confirm -> confirm/cancel` 闸门、runtime/CLI owner-path、admin/doctor 可观测摘要。当前仓库已具备 deterministic renderer、reporting-service 组装与发送、`send-five-store-daily-overview` 调度类型、orchestrator waiting 规则，以及“日报未完整则不发送共享总览”的降级边界。

## Current Implementation Checklist

### A. 已落地能力

- [x] 固定 6 段结构的 deterministic renderer 已落地
- [x] 基于 `DailyStoreReport.metrics` 组装 5 店共享输入已落地
- [x] 默认基线取 `bizDate - 7` 的上周同营业日对比已落地
- [x] 某店日报不完整时返回 `waiting`，不发送错误横向结论
- [x] shared delivery 发送链路已落地
- [x] `send-five-store-daily-overview` 调度类型、config 字段与 control-plane catalog 已落地
- [x] orchestrator 会等待 `send-report:<runKey>` 完成后再发送
- [x] `preview -> pending_confirm -> confirm/cancel` approval state 闸门已落地
- [x] runtime / CLI 的 render / preview / cancel / confirm owner-path 已落地
- [x] admin / doctor 的 5 店总览 readiness / latest status 摘要已落地
- [x] renderer / reporting-service / schedule / orchestrator / runtime regression 已覆盖
- [x] 普通工作日默认不单列背景因子，只有强扰动日才额外校准的表达边界已写入设计任务

### B. 当前已知缺口

- [ ] 还没有独立的 delivery audit / send history truth layer
- [ ] 共享目标仍默认复用 `reporting.sharedDelivery`，还没有单独的店长共看 target
- [ ] 还没有“特殊节假日 / 强天气 / 外部事件”结构化背景信号输入，目前只完成了表达边界，不包含自动判定

### C. 暂不做

- [ ] 不引入第二套 snapshot truth source
- [ ] 不把 AI 变成总览主判断器
- [ ] 不把这份总览与 HQ 周报 / 周图合并
- [ ] 不混入 external intelligence / 行业态势层
- [ ] 不把新职责塞回 `src/runtime.ts`

## Next Implementation Checklist

### P0: 先补可运营闭环

- [x] 给 reporting-service 增加 `preview -> pending_confirm -> confirm/cancel send` 状态闭环
- [x] 给 runtime 增加 `renderFiveStoreDailyOverview(...)` / `sendFiveStoreDailyOverviewPreview(...)` / `cancelFiveStoreDailyOverviewSend(...)` / `confirmFiveStoreDailyOverviewSend(...)` owner-path 方法
- [x] 给 CLI 增加 `five-store-daily-overview` 命令，支持 preview / cancel / confirm / override target
- [x] 给 admin read / doctor 增加该 job 的 readiness / latest status 摘要

### P1: 再补可持续演进能力

- [ ] 给差距拆解补结构化 reason codes，降低 renderer 文案和判断规则强耦合
- [ ] 给发送结果补最小 send history / audit read 面
- [ ] 评估是否需要为店长共看版增加独立共享目标配置

### P2: 最后再考虑增强表达

- [ ] 在 deterministic findings 稳定后，增加 bounded AI expression polishing
- [ ] 评估是否补少量辅助指标，但保持主 6 指标骨架不变
- [ ] 评估是否需要图形化版本，但不影响当前文字版稳定投递

---

### Task 1: 锁定 5 店总览的渲染契约

**Files:**
- Add: `src/five-store-daily-overview.ts`
- Add: `src/five-store-daily-overview.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

- 增加测试，验证 renderer 能基于 5 家店的昨日指标输出 6 段结构：
  - 一句话总览
  - 5 店量盘对比
  - 5 店质量对比
  - 上周同期变化
  - 差距拆解
  - 今日动作
- 验证第一版核心指标只依赖：
  - `serviceRevenue`
  - `customerCount`
  - `totalClockCount`
  - `pointClockRate`
  - `addClockRate`
  - `clockEffect`
- 验证缺少非核心指标时，不会渲染 `N/A`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/five-store-daily-overview.test.ts`

Expected:

- FAIL，因为当前还没有 5 店总览 renderer 和对应契约类型

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 增加最小结构：
  - `FiveStoreDailyOverviewInput`
  - `FiveStoreDailyOverviewStoreSnapshot`
- 在 `src/five-store-daily-overview.ts` 增加：
  - 输入模型
  - benchmark helper
  - markdown renderer
- 第一版只做 deterministic rendering，不接 AI

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/five-store-daily-overview.test.ts`

Expected:

- PASS，5 店总览正文契约稳定

### Task 2: 增加 deterministic gap diagnosis 与动作生成

**Files:**
- Modify: `src/five-store-daily-overview.ts`
- Modify: `src/five-store-daily-overview.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证系统能识别至少 4 类结构化差距：
  - 客流不差但加钟弱
  - 点钟不弱但钟效偏低
  - 量盘小但质量不差
  - 量盘领先但结构一般
- 验证输出：
  - `最值得复制`
  - `最需要修复`
  - `共性断点`
  - `每店今日先抓`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/five-store-daily-overview.test.ts -t "gap diagnosis"`

Expected:

- FAIL，因为当前 renderer 还没有差距诊断和动作层

**Step 3: Write minimal implementation**

- 在 `src/five-store-daily-overview.ts` 中增加：
  - 量盘 vs 质量拆分判断
  - 5 店中位值比较
  - 共性动作与分店动作生成
- 第一版坚持 deterministic 规则，不引入 AI 参与主判断

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/five-store-daily-overview.test.ts -t "gap diagnosis"`

Expected:

- PASS，差距拆解和今日动作具备最小经营指导价值

### Task 3: 在 reporting service 中组装 5 店总览输入

**Files:**
- Modify: `src/app/reporting-service.ts`
- Add: `src/app/reporting-service-five-store-overview.test.ts`

**Step 1: Write the failing test**

- 增加 service 级测试，验证：
  - 可以基于前一营业日加载 5 家店的已完成日报
  - 可以补取 `bizDate - 7` 的对比日报或同口径快照
  - 能生成完整 5 店总览 markdown
- 验证某店日报不完整时不会静默发送错误的横向总览

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/reporting-service-five-store-overview.test.ts`

Expected:

- FAIL，因为当前 reporting service 还没有 5 店共享总览组装逻辑

**Step 3: Write minimal implementation**

- 在 `src/app/reporting-service.ts` 增加：
  - `renderFiveStoreDailyOverview(...)`
  - `sendFiveStoreDailyOverview(...)`
- 复用现有 `resolveDailyReport(...)`
- 对比期优先取 `bizDate - 7` 的日报快照
- 第一版不新建 snapshot table，不新建额外 store

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/reporting-service-five-store-overview.test.ts`

Expected:

- PASS，reporting service 已能生成并发送 5 店共享总览

### Task 4: 增加共享投递与等待规则

**Files:**
- Modify: `src/sync-orchestrator.ts`
- Modify: `src/sync-orchestrator.test.ts`
- Modify: `src/sync-orchestrator-weekly-report.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证新 job：
  - 只有在 `send-report:<runKey>` 完成后才会发送
  - 若单店日报未全部完成，则输出 waiting 行而不是错误发送
  - 发送成功后会标记 scheduled job completed

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/sync-orchestrator.test.ts src/sync-orchestrator-weekly-report.test.ts`

Expected:

- FAIL，因为当前 orchestrator 还没有 5 店昨日总览发送分支

**Step 3: Write minimal implementation**

- 在 `src/sync-orchestrator.ts` 新增 job 分支：
  - `send-five-store-daily-overview`
- 复用现有 weekly report 的 waiting 模式：
  - 等 `send-report` 完整完成
- 不把发送时序硬编码在 runtime

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/sync-orchestrator.test.ts src/sync-orchestrator-weekly-report.test.ts`

Expected:

- PASS，新共享总览已具备安全等待与发送完成逻辑

### Task 5: 把新 job 接入调度与控制面

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/schedule.ts`
- Modify: `src/schedule.test.ts`
- Modify: `src/control-plane-contract.json`

**Step 1: Write the failing test**

- 增加调度测试，验证：
  - 存在 `send-five-store-daily-overview`
  - 受 `reporting.sendFiveStoreDailyOverviewEnabled` 控制
  - 受 `reporting.fiveStoreDailyOverviewAtLocalTime` 控制
  - 时间应晚于 `send-report`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/schedule.test.ts`

Expected:

- FAIL，因为当前调度类型、配置类型和 control-plane contract 还没有这个 job

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 增加：
  - reporting config 字段
  - `ScheduledJobType` 新值
- 在 `src/config.ts` 增加配置解析
- 在 `src/control-plane-contract.json` 增加 catalog entry
- 在 `src/schedule.ts` 增加新的 scheduler definition

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/schedule.test.ts`

Expected:

- PASS，调度、配置和控制面已认识新 job

### Task 6: 锁定共享投递文案与降级边界

**Files:**
- Modify: `src/app/reporting-service-five-store-overview.test.ts`
- Modify: `src/app/reporting-service.ts`
- Optionally Modify: `src/runtime.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证：
  - 文案标题是“5店昨日经营总览”而不是 HQ 周报
  - 共享内容不会写成 HQ 口吻
  - 某店缺失数据时，默认不发错误横向结论
  - 不出现 `N/A`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/reporting-service-five-store-overview.test.ts src/runtime.test.ts`

Expected:

- FAIL，因为当前还没有共享总览的文案风格和降级边界测试

**Step 3: Write minimal implementation**

- 在 renderer 或 service 层补最小文案保护：
  - 店长共看版标题
  - 差距拆解优先于 HQ 口吻
  - 缺失时不发送或明确 waiting

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/reporting-service-five-store-overview.test.ts src/runtime.test.ts`

Expected:

- PASS，文案风格与降级边界被锁定

### Task 7: 全链回归与文档回写

**Files:**
- Modify: `docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md`

**Step 1: Run targeted regression suite**

Run: `pnpm exec vitest run src/five-store-daily-overview.test.ts src/app/reporting-service-five-store-overview.test.ts src/schedule.test.ts src/sync-orchestrator.test.ts src/sync-orchestrator-weekly-report.test.ts src/app/reporting-service-weekly-report.test.ts`

Expected:

- PASS，5 店昨日经营总览的 renderer、service、schedule、delivery 等关键链路通过

**Step 2: Run delivery-path verification**

Run: `pnpm exec vitest run src/runtime.test.ts -t "send-five-store-daily-overview"`

Expected:

- PASS，或在实现前先新增对应回归用例并通过

**Step 3: Update progress notes**

- 在 full-stack 计划中回写：
  - 单店日报之后的 5 店共享店长总览已进入读面
  - 当前仍是 deterministic-first，不是 HQ unified context fully landed

Plan complete and saved to `docs/plans/2026-04-23-five-store-daily-overview-implementation-plan.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints
