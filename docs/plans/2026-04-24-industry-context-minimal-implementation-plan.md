# Industry Context Minimal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `htops` 增加最小可生产的行业态势 owner module、snapshot store 与周报接入口，让 HQ 周报和 world model supplement 能稳定读取行业弱信号。

**Architecture:** 保持 `PostgreSQL truth source + owner modules + bounded read surfaces` 路线，不引入第二套 runtime。先增加全局 `industry_context_snapshots` 存储和 `src/industry-context.ts` 装配层，再把结果以可选方式接入 HQ 周报的 world model supplement；默认只进入 HQ narrative / explanation，不进入单店硬评分和单客召回主评分。

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, current `src/world-model/`, `src/app/reporting-service.ts`, `src/weekly-report.ts`

---

### Task 1: 增加行业态势快照类型

**Files:**
- Modify: `src/types.ts`
- Test: `src/industry-context.test.ts`

**Step 1: Write the failing test**

- 新增测试，验证存在：
  - `HetangIndustryContextSignalKind`
  - `HetangIndustryContextSnapshotRecord`
- 验证最小字段覆盖：
  - `snapshotDate`
  - `signalKind`
  - `signalKey`
  - `title`
  - `summary`
  - `confidence`
  - `truthBoundary`
  - `sourceType`
  - `applicableModules`
  - `updatedAt`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/industry-context.test.ts`

Expected:

- FAIL，因为当前仓库还没有行业态势的正式类型和 owner module

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 中新增行业态势信号种类和 snapshot record 类型
- 明确默认边界是 `weak_signal`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/industry-context.test.ts`

Expected:

- PASS，类型边界明确

### Task 2: 增加行业态势快照表与 store owner methods

**Files:**
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

**Step 1: Write the failing test**

- 在 `src/store.test.ts` 增加测试，验证：
  - `store.initialize()` 会创建 `industry_context_snapshots`
  - 可写入多条 snapshot
  - 可按 `snapshotDate` 读取并返回最新日期快照

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists industry context snapshots"`

Expected:

- FAIL，因为当前还没有行业态势表和对应 owner methods

**Step 3: Write minimal implementation**

- 在 `src/store.ts` 中新增：
  - `industry_context_snapshots` 表
  - `upsertIndustryContextSnapshot()`
  - `listIndustryContextSnapshots()`
- 保持读取语义：
  - 指定日期则读该日期
  - 未指定日期则读最新 `snapshot_date`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists industry context snapshots"`

Expected:

- PASS，行业态势 owner store 建立

### Task 3: 增加 industry-context owner module

**Files:**
- Add: `src/industry-context.ts`
- Add: `src/industry-context.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 owner module 能：
  - 过滤 `applicableModules`
  - 输出 HQ / world model 可消费的 observations
  - 在无数据时返回安全空结果

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/industry-context.test.ts`

Expected:

- FAIL，因为当前没有行业态势 assembler

**Step 3: Write minimal implementation**

- 新增 `src/industry-context.ts`
- 提供：
  - `assembleIndustryContextPayload()`
  - `loadIndustryContextPayload()`
  - `mapIndustryContextToWorldModelObservations()`
- 默认只支持：
  - `hq_narrative`
  - `world_model`
  - `store_diagnosis`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/industry-context.test.ts`

Expected:

- PASS，形成最小行业态势 owner module

### Task 4: 接入 HQ 周报 world model supplement

**Files:**
- Modify: `src/weekly-report.ts`
- Modify: `src/weekly-report.test.ts`
- Modify: `src/app/reporting-service.ts`
- Modify: `src/app/reporting-service-weekly-report.test.ts`

**Step 1: Write the failing test**

- 为 `renderFiveStoreWeeklyReport()` 增加测试，验证传入 industry observations 时：
  - world model supplement 会吸收行业态势摘要
  - 无行业态势时现有输出不变
- 为 reporting service 增加测试，验证它会在存在 store owner method 时加载最新行业态势并传给周报

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/weekly-report.test.ts src/app/reporting-service-weekly-report.test.ts`

Expected:

- FAIL，因为当前周报还没有行业态势 owner 输入

**Step 3: Write minimal implementation**

- 让 `renderFiveStoreWeeklyReport()` 支持可选 `industryObservations`
- 让 `HetangReportingService.renderWeeklyReport()` 在 store 上检测 `listIndustryContextSnapshots`
- 仅把行业态势接到 world model supplement，不改周报硬事实主文

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/weekly-report.test.ts src/app/reporting-service-weekly-report.test.ts`

Expected:

- PASS，行业态势最小接入 HQ 周报读链

