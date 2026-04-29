# 5店昨日经营总览自动直发与 CGO 级升级 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `5店昨日经营总览` 自动发送卡点，让它在单店日报全部发送完成后自动直发龙虾测试群，并把总览内容升级成更接近顶级 CGO 的组合盘经营判断。

**Architecture:** 保持 `DailyStoreReport.metrics + reporting-service + sync-orchestrator + shared delivery` 主线，不引入第二套 truth source。发送层改成自动 direct send 优先读缓存日报；内容层新增 deterministic findings，把总览从“横向汇总”升级成“主矛盾 + 角色图 + 唯一动作”。

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, `src/app/reporting-service.ts`, `src/five-store-daily-overview.ts`, `src/app/admin-read-service.ts`, `src/sync-orchestrator.ts`, `src/notify.ts`

---

### Task 1: 修正新版日报的 freshness 误判

**Files:**
- Modify: `src/app/admin-read-service.ts`
- Modify: `src/app/reporting-service.ts`
- Test: `src/ops/doctor.test.ts`
- Test: `src/app/reporting-service-five-store-overview.test.ts`

**Step 1: Write the failing test**

- 增加测试，证明包含 `【补充指标】` 和 `预估到店人数：` 的新版正式日报不应再被判成 `refresh-needed`
- 增加测试，证明 `resolveDailyReport(...)` 遇到新版缓存正式日报时，优先直接返回缓存结果，而不是触发 rebuild

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/app/reporting-service-five-store-overview.test.ts src/ops/doctor.test.ts`

Expected:

- FAIL，因为当前 freshness 规则仍把新版日报误判为需要刷新

**Step 3: Write minimal implementation**

- 在 `src/app/admin-read-service.ts` 的 `needsDailyReportMarkdownRefresh(...)` 中移除对 `【补充指标】` 的旧式误判
- 在 `src/app/reporting-service.ts` 的 `cachedReportNeedsMarkdownRefresh(...)` 中同步修正
- 保留对真正旧版格式的识别：
  - `【详细指标】`
  - 缺少 `预估到店人数：`
  - 旧 markdown 标题格式

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/app/reporting-service-five-store-overview.test.ts src/ops/doctor.test.ts`

Expected:

- PASS，状态面不再把新版日报误报为 `refresh-needed`

### Task 2: 让 5 店总览自动发送优先只读缓存正式日报

**Files:**
- Modify: `src/app/reporting-service.ts`
- Test: `src/app/reporting-service-five-store-overview.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 5 店总览组装当前日报时：
  - 若 `mart_daily_store_reports` 中已有 `complete=true` 的正式日报，直接使用
  - 不再调用 `buildDailyStoreReport(...)` 慢路径
- 增加测试，验证基线日报 `bizDate - 7` 同样优先读取缓存

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/app/reporting-service-five-store-overview.test.ts`

Expected:

- FAIL，因为当前 service 仍可能对新版正式日报走 rebuild 路径

**Step 3: Write minimal implementation**

- 在 `src/app/reporting-service.ts` 中抽一个“优先读缓存正式日报”的 helper
- `resolveFiveStoreDailyOverviewInput(...)` 对当前日报和基线日报都优先用缓存正式日报
- 只有“缓存缺失”或“缓存不完整”时才走 waiting / rebuild 分支

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/app/reporting-service-five-store-overview.test.ts`

Expected:

- PASS，5 店总览发送时不再依赖日报重建

### Task 3: 把自动发送从 preview gate 改成 direct send

**Files:**
- Modify: `src/app/reporting-service.ts`
- Modify: `src/sync-orchestrator.ts`
- Modify: `src/cli.ts`
- Test: `src/app/reporting-service-five-store-overview.test.ts`
- Test: `src/sync-orchestrator-five-store-overview.test.ts`
- Test: `src/cli.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证调度触发 `sendFiveStoreDailyOverview(...)` 时默认直接发送 shared delivery，而不是发给 `ZhangZhen`
- 增加测试，验证 manual preview command 仍可保留，用于人工预览
- 增加测试，验证 direct send 成功后会把 scheduled job 标为 completed

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/app/reporting-service-five-store-overview.test.ts src/sync-orchestrator-five-store-overview.test.ts src/cli.test.ts`

Expected:

- FAIL，因为当前 `sendFiveStoreDailyOverview(...)` 仍默认 preview

**Step 3: Write minimal implementation**

- 给 `sendFiveStoreDailyOverview(...)` 增加 `deliveryMode?: "direct" | "preview"` 参数
- 默认 `direct`
- `preview` 保留给 CLI 手工入口
- scheduler 调用 direct 模式
- direct 模式：
  - 直接发 `reporting.sharedDelivery`
  - 写入 `stage=sent`
  - 不再要求 `pending_confirm`

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/app/reporting-service-five-store-overview.test.ts src/sync-orchestrator-five-store-overview.test.ts src/cli.test.ts`

Expected:

- PASS，自动链直发共享群，手工 preview 仍可用

### Task 4: 升级 5 店总览的 deterministic findings

**Files:**
- Modify: `src/five-store-daily-overview.ts`
- Modify: `src/types.ts`
- Test: `src/five-store-daily-overview.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证总览能稳定输出：
  - 唯一主判断
  - 组合盘结构拆解
  - 每店角色图
  - 非对称变化解释
  - 系统约束点
  - 每店唯一优先动作

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/five-store-daily-overview.test.ts`

Expected:

- FAIL，因为当前 renderer 还停留在共享战报层，不是 CGO 级 finding layer

**Step 3: Write minimal implementation**

- 在 `src/five-store-daily-overview.ts` 中新增最小 deterministic finding helpers：
  - `resolveGrowthSource(...)`
  - `resolveDragSource(...)`
  - `resolveStructuralAsymmetry(...)`
  - `resolveStoreRole(...)`
  - `resolveSystemConstraint(...)`
  - `resolveSinglePriorityAction(...)`
- 仍保持 6 段，但重写段内表达：
  - 总判断
  - 结构拆解
  - 门店角色图
  - 非对称变化
  - 系统约束
  - 今日动作

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/five-store-daily-overview.test.ts`

Expected:

- PASS，总览从“汇总”升级到“经营判断”

### Task 5: 保持 doctor / status 面与新自动链一致

**Files:**
- Modify: `src/ops/doctor.ts`
- Modify: `src/app/admin-read-service.ts`
- Test: `src/ops/doctor.test.ts`
- Test: `src/runtime.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 direct send 模式下：
  - `5店昨日经营总览` 的状态能显示 `sent`
  - readiness 不再被新版日报误判压成 `0/5 ready`

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/ops/doctor.test.ts src/runtime.test.ts`

Expected:

- FAIL，因为当前状态面仍以 preview gate 语义为主

**Step 3: Write minimal implementation**

- 让 doctor/admin read 的 summary 与 direct send 语义一致
- 保留 preview 状态展示，但不再假设 preview 是主路径

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/ops/doctor.test.ts src/runtime.test.ts`

Expected:

- PASS，状态面与自动直发链一致

### Task 6: 跑完整回归并验证真实发送路径

**Files:**
- No code changes expected

**Step 1: Run focused regression**

Run:

```bash
npm test -- --run \
  src/five-store-daily-overview.test.ts \
  src/app/reporting-service-five-store-overview.test.ts \
  src/sync-orchestrator-five-store-overview.test.ts \
  src/ops/doctor.test.ts \
  src/cli.test.ts \
  src/runtime.test.ts
```

Expected:

- PASS，自动发送、状态面、renderer 全部回归通过

**Step 2: Verify live owner-path locally**

Run:

```bash
node --import tsx src/main.ts hetang status
node --import tsx src/main.ts hetang five-store-daily-overview render --date 2026-04-23
```

Expected:

- `status` 中 `5店昨日经营总览` 不再卡在错误 freshness
- render 输出新的 CGO 级结构

**Step 3: Verify send adapter path**

Run:

```bash
node --import tsx --input-type=module - <<'NODE'
// loadStandaloneRuntimeEnv()
// sendReportMessage(...) to 龙虾测试群
NODE
```

Expected:

- 通过当前 configured adapter 成功发送

### Task 7: Commit docs and code changes

**Files:**
- Modify/Add only the files above

**Step 1: Review diff**

Run:

```bash
git diff -- docs/plans/2026-04-24-five-store-daily-overview-auto-send-and-cgo-upgrade-design.md \
docs/plans/2026-04-24-five-store-daily-overview-auto-send-and-cgo-upgrade-implementation-plan.md \
src/five-store-daily-overview.ts \
src/app/reporting-service.ts \
src/app/admin-read-service.ts \
src/sync-orchestrator.ts \
src/ops/doctor.ts \
src/cli.ts
```

Expected:

- Only intended files changed

**Step 2: Commit**

```bash
git add docs/plans/2026-04-24-five-store-daily-overview-auto-send-and-cgo-upgrade-design.md \
docs/plans/2026-04-24-five-store-daily-overview-auto-send-and-cgo-upgrade-implementation-plan.md \
src/five-store-daily-overview.ts src/types.ts src/app/reporting-service.ts \
src/app/admin-read-service.ts src/sync-orchestrator.ts src/ops/doctor.ts src/cli.ts \
src/five-store-daily-overview.test.ts src/app/reporting-service-five-store-overview.test.ts \
src/sync-orchestrator-five-store-overview.test.ts src/ops/doctor.test.ts src/cli.test.ts src/runtime.test.ts
git commit -m "feat: auto-send five-store overview with deeper operating diagnosis"
```
