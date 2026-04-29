# Weekly HQ Package Rollout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把“周报正文 + 周图”收口成可正式推送总部群的周经营包，并通过起始日期闸门保证今天不发、下周一自动生效，同时补一份店长使用教程。

**Architecture:** 继续沿用现有 `reporting-service -> weekly-report -> weekly-chart-image -> schedule -> sync-orchestrator` owner path，不新增数据库或第二条发送链路。核心改动只包括三类：周报正文口径统一、调度 start-date gating、文档补齐。

**Tech Stack:** TypeScript, Vitest, existing scheduler/reporting runtime, Markdown docs

---

### Task 1: 为周报/周图起始日期闸门写失败测试

**Files:**
- Modify: `src/config.test.ts`
- Modify: `src/schedule-weekly-report.test.ts`
- Modify: `src/schedule-weekly-chart.test.ts`
- Modify: `src/sync-orchestrator-weekly-report.test.ts`
- Modify: `src/sync-orchestrator-weekly-chart.test.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/schedule.ts`
- Modify: `src/sync-orchestrator.ts`

**Step 1: Write the failing test**

- 在 `src/config.test.ts` 增加断言：
  - `reporting.weeklyReportStartDate`
  - `reporting.weeklyChartStartDate`
  - 未配置时为 `undefined`
  - 配置时正确解析
- 在 `src/schedule-weekly-report.test.ts` 增加断言：
  - 周一时间已到，但 `nowDate < weeklyReportStartDate` 时，周报 job 不 due
- 在 `src/schedule-weekly-chart.test.ts` 增加断言：
  - 周一时间已到，但 `nowDate < weeklyChartStartDate` 时，周图 job 不 due
- 在 orchestrator 相关测试中保持现有执行顺序不变，只要求 start-date 通过后行为与之前一致

**Step 2: Run test to verify it fails**

Run:
- `npx vitest run src/config.test.ts src/schedule-weekly-report.test.ts src/schedule-weekly-chart.test.ts src/sync-orchestrator-weekly-report.test.ts src/sync-orchestrator-weekly-chart.test.ts`

Expected:

- 新增的 start-date 测试失败，因为当前 config/schedule 还不认识这两个字段。

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 为 reporting config 增加两个可选字段
- 在 `src/config.ts` 解析这两个字段
- 在 `src/schedule.ts` 的 context 中增加对应 start-date，并让 `send-weekly-report` / `send-weekly-chart` 只有在 `nowDate >= startDate` 时才 due
- 在 `src/sync-orchestrator.ts` 透传新配置给 scheduler

**Step 4: Run test to verify it passes**

Run:
- `npx vitest run src/config.test.ts src/schedule-weekly-report.test.ts src/schedule-weekly-chart.test.ts src/sync-orchestrator-weekly-report.test.ts src/sync-orchestrator-weekly-chart.test.ts`

Expected:

- start-date 相关测试通过，且不破坏原有周报/周图执行顺序。

### Task 2: 为周报正文口径统一写失败测试

**Files:**
- Modify: `src/weekly-report.test.ts`
- Modify: `src/weekly-report.ts`

**Step 1: Write the failing test**

- 扩展 `src/weekly-report.test.ts`，要求周报输出：
  - 仍保留 `荷塘悦色5店经营周报`
  - 在经营总览里出现：
    - `客流`
    - `加钟率`
    - `点钟率`
    - `新增会员`
    - `本周新增储值`
  - 不再把 `团购7天复到店` 当作正文主表达
  - 各店动作行继续有差异化，不能都一样

**Step 2: Run test to verify it fails**

Run:
- `npx vitest run src/weekly-report.test.ts`

Expected:

- 失败，因为当前周报主叙事仍明显依赖旧指标。

**Step 3: Write minimal implementation**

- 在 `src/weekly-report.ts` 的 weekly aggregate 中增加：
  - `pointClockRate`
  - `rechargeCash`
- 调整链路判断与动作候选：
  - 优先使用 `客流 / 加钟率 / 点钟率 / 新增会员 / 本周新增储值`
  - 降低或移除 `团购7天复到店` 在主叙事中的权重
- 调整经营总览和逐店动作输出，使正文与周图口径一致

**Step 4: Run test to verify it passes**

Run:
- `npx vitest run src/weekly-report.test.ts`

Expected:

- 周报正文结构测试通过，且输出更贴近总部经营包语言。

### Task 3: 配置正式上线任务但避免今天触发

**Files:**
- Modify: `htops.json`
- Modify: `src/config.test.ts` if needed

**Step 1: Write the failing test**

- 若需要，在 `src/config.test.ts` 补一条实际配置解析断言：
  - 周报、周图启用后，start-date 仍可阻止当周误发

**Step 2: Run test to verify it fails**

Run:
- `npx vitest run src/config.test.ts`

Expected:

- 若新增了断言，则当前配置/解析未覆盖时失败。

**Step 3: Write minimal implementation**

- 在 `htops.json` 中配置：
  - `sendWeeklyReportEnabled: true`
  - `sendWeeklyChartEnabled: true`
  - `weeklyReportStartDate: "2026-04-27"`
  - `weeklyChartStartDate: "2026-04-27"`

**Step 4: Run test to verify it passes**

Run:
- `npx vitest run src/config.test.ts src/schedule-weekly-report.test.ts src/schedule-weekly-chart.test.ts`

Expected:

- 配置层与调度层保持一致，今天不会因配置调整误发。

### Task 4: 补店长使用教程

**Files:**
- Add: `docs/store-manager-reporting-guide.md`

**Step 1: Write the doc**

- 教程必须覆盖：
  - 日报怎么读
  - 周报怎么读
  - 周图怎么读
  - `/hetang reactivation summary|tasks|update` 怎么配合
  - 店长每周一、每天中午、每天收班前各该做什么

**Step 2: Self-check**

- 确认文档不是技术说明，而是经营动作教程
- 确认术语与周报正文一致

### Task 5: 做 dry-run 验证，但不发送

**Files:**
- No new files unless formatting issues appear

**Step 1: Run verification**

Run:
- `npx vitest run src/config.test.ts src/weekly-report.test.ts src/schedule-weekly-report.test.ts src/schedule-weekly-chart.test.ts src/sync-orchestrator-weekly-report.test.ts src/sync-orchestrator-weekly-chart.test.ts`
- `node --import tsx scripts/send-weekly-report.ts --date 2026-04-19 --dry-run`
- `node --import tsx scripts/send-weekly-chart.ts --date 2026-04-19 --dry-run`

Expected:

- 所有测试通过
- dry-run 能输出正式周报正文
- dry-run 能生成正式周图 PNG 路径
- 不向任何群发送消息或图片
