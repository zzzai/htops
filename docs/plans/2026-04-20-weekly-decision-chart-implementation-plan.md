# Weekly Decision Chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把现有周经营决策图的逐店辅助指标改为 `客流 / 加钟率 / 点钟率 / 新增会员 / 本周新增储值`，替换掉团购复购率，并保持手机端可读性。

**Architecture:** 继续复用 `DailyStoreReport -> reporting-service -> weekly-chart-image -> Chrome rasterize -> WeCom image send` 这条 owner path，不新增数据库。核心改动集中在 `src/weekly-chart-image.ts` 的 dataset 与 SVG 渲染层，把逐店信号从 3 个扩成 5 个，并把储值口径固定为最近 7 天 `rechargeCash` 汇总。

**Tech Stack:** TypeScript, Vitest, SVG rendering, Google Chrome headless, existing reporting service

---

### Task 1: 为新信号口径写失败测试

**Files:**
- Modify: `src/weekly-chart-image.test.ts`
- Modify: `src/weekly-chart-image.ts`

**Step 1: Write the failing test**

- 在 `src/weekly-chart-image.test.ts` 增加测试，断言新 dataset 至少包含：
  - `stores[*].signals` 标签顺序固定为：
    - `客流`
    - `加钟率`
    - `点钟率`
    - `新增会员`
    - `本周新增储值`
  - `本周新增储值` 的当前值来源于最近 7 天 `rechargeCash` 汇总
  - `新增会员` 来源于最近 7 天 `newMembers` 汇总
  - `点钟率` 来源于 `pointClockRecordCount / upClockRecordCount`
- 断言旧标签 `团购客复购率` 已不再出现。

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- 因为当前 dataset 仍包含 `团购客复购率`，测试失败。

**Step 3: Write minimal implementation**

- 在 `src/weekly-chart-image.ts` 中：
  - 为 weekly aggregate 增加：
    - `pointClockRate`
    - `newMembers`
    - `rechargeCash`
  - 逐店 signals 改为 5 条新信号
  - `本周新增储值` 使用 `rechargeCash`

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- dataset 新信号口径测试通过。

### Task 2: 调整逐店行 SVG 布局以容纳 5 个信号

**Files:**
- Modify: `src/weekly-chart-image.test.ts`
- Modify: `src/weekly-chart-image.ts`

**Step 1: Write the failing test**

- 在 `src/weekly-chart-image.test.ts` 增加 SVG 结构测试，断言新图包含：
  - `点钟率`
  - `新增会员`
  - `本周新增储值`
  - 且不再包含 `团购客复购率`
- 保持本周/上周双折线与日期标签不变。

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- 因为旧 renderer 还在渲染 `团购客复购率`，测试失败。

**Step 3: Write minimal implementation**

- 重构 `renderWeeklyStoreChartSvg()`：
  - 保持顶部 summary 与中部折线不变
  - 逐店右侧信号区从 3 行扩到 5 行
  - 行高按最小幅度增加，避免手机端拥挤
  - `本周新增储值` 值使用金额格式，`新增会员` 使用人数格式，`点钟率` 使用百分比格式
  - 洞察文案不再引用已移除的团购复购率

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/weekly-chart-image.test.ts`

Expected:

- 新 SVG 结构测试通过。

### Task 3: 做针对性回归验证

**Files:**
- No new files unless regressions appear

**Step 1: Write the failing test**

- 不新增额外行为测试；直接运行现有相关测试集合。

**Step 2: Verify**

Run:
- `npx vitest run src/weekly-chart-image.test.ts src/app/reporting-service-weekly-chart.test.ts src/command-weekly-chart.test.ts src/config.test.ts src/schedule.test.ts src/schedule-weekly-chart.test.ts src/sync-orchestrator-weekly-chart.test.ts`

Expected:

- 所有相关测试通过。

### Task 4: 重新生成真实样板 PNG

**Files:**
- No code change required if previous tasks pass

**Step 1: Generate preview**

Run:
- `node --import tsx scripts/send-weekly-chart.ts --date 2026-04-19 --dry-run`

Expected:

- 输出新的 PNG 文件路径

**Step 2: Visual verification**

- 打开生成的 PNG，确认：
  - 右侧 5 个信号可读，不挤压
  - `本周新增储值` 金额格式正确
  - `新增会员` 与 `点钟率` 显示自然
  - 每店判断不再引用团购复购
