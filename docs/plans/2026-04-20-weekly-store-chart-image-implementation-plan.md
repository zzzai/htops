# Weekly Store Chart Image Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为荷塘悦色 5 店生成“按天维度的周经营长图 PNG”，支持企微按需发送与每周一周报后的自动推送。

**Architecture:** 复用现有 `DailyStoreReport` / `mart_daily_store_reports` 作为事实输入，不新建数据库。新增一条 `weekly chart image` owner path：`daily report snapshots -> weekly chart dataset -> Apple-style SVG/HTML -> Chrome headless rasterize -> WeCom image send`。发送链路不改现有文本周报，而是补一条独立的图片发送能力，并以独立 job/command 接入，避免图表失败影响文本周报。

**Tech Stack:** TypeScript, Vitest, existing reporting service, Google Chrome headless, WeCom bot SDK

---

### Task 1: 打通企业微信图片发送能力

**Files:**
- Modify: `src/notify.ts`
- Modify: `src/notify.test.ts`
- Modify: `ops/wecom-send-group.mjs`

**Step 1: Write the failing test**

- 在 `src/notify.test.ts` 增加图片发送测试，断言新增图片发送 helper 会调用专用 wecom sender，并传入本地 PNG 路径。
- 断言非 `wecom` channel 会被显式拒绝，而不是静默降级成文本发送。

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/notify.test.ts`

Expected:

- 新增图片发送测试先失败，因为当前只支持 markdown 文本发送。

**Step 3: Write minimal implementation**

- 在 `ops/wecom-send-group.mjs` 增加图片发送模式：
  - 保留原有 `markdown` 发送逻辑
  - 新增 `image` 模式：上传本地文件拿到 `media_id`，再发送 `image` 消息
- 在 `src/notify.ts` 增加显式的 `sendHetangImage` / `sendReportImage` helper
- 暂时只支持 `wecom` channel，其他 channel 抛出清晰错误

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/notify.test.ts`

Expected:

- 新增/原有通知测试全部通过

### Task 2: 构建 5 店周图表数据集与 Apple 风格长图渲染

**Files:**
- Add: `src/weekly-chart-image.ts`
- Add: `src/weekly-chart-image.test.ts`

**Step 1: Write the failing test**

- 为 `buildWeeklyStoreChartDataset()` 增加测试，断言它会产出 5 店 * 7 天 * 8 指标的稳定结构
- 为 `renderWeeklyStoreChartSvg()` 增加测试，断言：
  - 标题为 `荷塘悦色5店周经营图表`
  - 包含 5 个门店短名
  - 每店包含 8 个指标卡
  - 关键指标名包含：营收、储值、客流、客单价、加钟率、点钟率、新增会员数、团购客复购率

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- 新增测试先失败，因为图表数据集与 SVG 渲染模块还不存在

**Step 3: Write minimal implementation**

- 在 `src/weekly-chart-image.ts` 定义图表数据结构
- 新增数据集 builder：
  - 输入：每店最近 7 天 `DailyStoreReport`
  - 输出：固定顺序的 8 个指标 timeseries
- 新增 Apple 风格 SVG 渲染：
  - 整图浅灰背景、白卡片、深灰文字、单色蓝强调
  - 长图按门店纵向排列
  - 每店 2 列 * 4 行指标卡，适配手机端阅读
  - 每张卡片包含当前值、7 天 sparkline、短标签

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- 图表模块测试通过

### Task 3: 用 Chrome headless 把 SVG/HTML 栅格化成 PNG

**Files:**
- Modify: `src/weekly-chart-image.ts`
- Modify: `src/weekly-chart-image.test.ts`

**Step 1: Write the failing test**

- 为 `buildWeeklyStoreChartImage()` 增加测试，断言：
  - 会把 SVG/HTML 落到临时目录
  - 会调用 `google-chrome-stable --headless` 生成 PNG
  - 返回生成后的 PNG 路径

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- 新增 PNG 构建测试失败，因为还没有 rasterize 逻辑

**Step 3: Write minimal implementation**

- 在 `src/weekly-chart-image.ts` 增加 `buildWeeklyStoreChartImage()`：
  - 写入临时 HTML/SVG 文件
  - 通过 `google-chrome-stable --headless=new --screenshot` 生成 PNG
  - 返回 PNG 路径
- 保持命令可注入，便于测试 mock

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- PNG 生成测试通过

### Task 4: 把周图表接入 reporting service

**Files:**
- Modify: `src/app/reporting-service.ts`
- Add: `src/app/reporting-service-weekly-chart.test.ts`
- Modify: `src/runtime.ts`

**Step 1: Write the failing test**

- 为 reporting service 增加测试，断言：
  - 能收集 5 店最近 7 天日报快照并构建图表图片
  - `dryRun` 时返回本地文件路径而不发送
  - 正式发送时调用 `sendReportImage`

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/reporting-service-weekly-chart.test.ts`

Expected:

- 测试失败，因为 reporting service 还没有 weekly chart image 能力

**Step 3: Write minimal implementation**

- 在 `HetangReportingService` 中新增：
  - `renderWeeklyChartImage()`
  - `sendWeeklyChartImage()`
- 复用现有 `resolveDailyReport()` 获取最近 7 天稳定日报快照
- 在 `runtime.ts` 只增加薄 delegation wrapper，不塞入新的业务逻辑

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/reporting-service-weekly-chart.test.ts`

Expected:

- reporting service 图表测试通过

### Task 5: 增加企微按需命令入口

**Files:**
- Modify: `src/access/access-types.ts`
- Modify: `src/access/access-context.ts`
- Modify: `src/access.ts`
- Modify: `src/command.ts`
- Add: `src/command-weekly-chart.test.ts`

**Step 1: Write the failing test**

- 为命令处理增加测试，断言：
  - `/hetang chart weekly`
  - `/hetang chart weekly 2026-04-19`
  - HQ 用户可以触发图片发送
  - 非 HQ 用户会被权限拦截

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/command-weekly-chart.test.ts`

Expected:

- 新命令测试失败，因为当前还没有 `chart` action

**Step 3: Write minimal implementation**

- 在 access layer 增加 `chart` action
- 按 HQ-only 权限处理
- 在 `command.ts` 增加 `/hetang chart weekly [YYYY-MM-DD]`
- 命令执行时调用 runtime/reporting service 发图，并返回短确认文案

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/command-weekly-chart.test.ts`

Expected:

- 图表命令测试通过

### Task 6: 增加周一自动推送 job

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/schedule.ts`
- Modify: `src/schedule.test.ts`
- Modify: `src/sync-orchestrator.ts`
- Add: `src/schedule-weekly-chart.test.ts`
- Add: `src/sync-orchestrator-weekly-chart.test.ts`
- Modify: `htops.json`

**Step 1: Write the failing test**

- 为 config 增加 `sendWeeklyChartEnabled`、`weeklyChartAtLocalTime`
- 为 schedule 增加 `send-weekly-chart`
- 为 orchestrator 增加测试，断言它会在周一文本周报之后发送图表图片

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config.test.ts src/schedule.test.ts src/schedule-weekly-chart.test.ts src/sync-orchestrator-weekly-chart.test.ts`

Expected:

- 新增测试失败，因为当前没有 weekly chart job

**Step 3: Write minimal implementation**

- config 增加：
  - `reporting.sendWeeklyChartEnabled`
  - `reporting.weeklyChartAtLocalTime`
- schedule 增加 `send-weekly-chart`
- orchestrator 在文本周报之后独立执行 weekly chart job，避免文本周报与图片发送耦合失败
- 在 `htops.json` 启用 weekly chart，并把时间设为周报后几分钟

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/config.test.ts src/schedule.test.ts src/schedule-weekly-chart.test.ts src/sync-orchestrator-weekly-chart.test.ts`

Expected:

- 周图表配置/调度测试通过

### Task 7: 增加脚本与样图验证

**Files:**
- Add: `scripts/send-weekly-chart.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

- 如果需要，为脚本增加轻量 smoke test；否则至少保证 `--dry-run` 可本地生成 PNG

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/reporting-service-weekly-chart.test.ts`

Expected:

- 若脚本 smoke 覆盖了 CLI，则新增断言先失败

**Step 3: Write minimal implementation**

- 增加 `scripts/send-weekly-chart.ts`
- 支持：
  - `--date`
  - `--dry-run`
  - `--target`
  - `--channel`
- `--dry-run` 时输出生成图片路径，方便人工预览

**Step 4: Run test to verify it passes**

Run:

- `npx vitest run src/app/reporting-service-weekly-chart.test.ts`
- `node --import tsx scripts/send-weekly-chart.ts --date 2026-04-19 --dry-run`

Expected:

- 输出本地 PNG 路径

### Task 8: 定向验证与真实样图生成

**Files:**
- Modify: `docs/plans/2026-04-20-weekly-store-chart-image-implementation-plan.md`

**Step 1: Run targeted verification**

Run:

- `npx vitest run src/notify.test.ts src/weekly-chart-image.test.ts src/app/reporting-service-weekly-chart.test.ts src/command-weekly-chart.test.ts src/config.test.ts src/schedule.test.ts src/schedule-weekly-chart.test.ts src/sync-orchestrator-weekly-chart.test.ts`

**Step 2: Generate a real preview image**

Run:

- `node --import tsx scripts/send-weekly-chart.ts --date 2026-04-19 --dry-run`

Expected:

- 生成真实 PNG 文件，可人工检查样式

**Step 3: Optional live send**

Run:

- `node --import tsx scripts/send-weekly-chart.ts --date 2026-04-19`

Expected:

- 图表发送到 configured shared delivery target

**Step 4: Report exact commands**

- 汇报真实执行命令
- 汇报样图路径
- 若已 live send，说明是否已重启 scheduled worker 以及实际启用时间
