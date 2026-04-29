# Store Master Data And External Intelligence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 `htops` 架构上补齐门店主数据、外部观察、原始证据和派生特征的生产级数据底座，让后续高德 / 美团 / 抖音 / 小红书等数据都有稳定落点，并逐步进入算法与 AI 读链。

**Architecture:** 保持 `PostgreSQL first` 和当前 owner store 主链不变，新增 `store master profile -> external observation -> feature snapshot -> runtime publishing` 四段式路径。继续保留 `store_external_context_entries` 作为受控发布层，不让 AI 直接读取原始网页和未校验事实。

**Tech Stack:** TypeScript, PostgreSQL owner store, Vitest, current external-intelligence modules, current world-model modules, checked-in JSON import scripts, optional future `PostGIS` / `pgvector`

---

### Task 1: 引入门店主数据表与 owner store 读写接口

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 在 `src/store.test.ts` 增加门店主数据测试
- 断言 `store.initialize()` 会创建：
  - `store_master_profiles`
  - `store_master_profile_snapshots`
- 断言可完成：
  - upsert 最新主数据
  - 读取当前主数据
  - 写入历史快照

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store master profiles and profile snapshots"`

Expected:

- FAIL，因为当前还没有这两张表和对应读写接口

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 中新增：
  - `HetangStoreMasterProfile`
  - `HetangStoreMasterProfileSnapshot`
- 在 `src/store.ts` 中新增：
  - 表定义
  - 索引
  - `upsertStoreMasterProfile()`
  - `getStoreMasterProfile()`
  - `insertStoreMasterProfileSnapshot()`
  - `listStoreMasterProfileSnapshots()`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store master profiles and profile snapshots"`

Expected:

- PASS，主数据真相层建立

**Step 5: Commit**

```bash
git add src/types.ts src/store.ts src/store.test.ts
git commit -m "feat: add store master profile storage"
```

### Task 2: 增加门店主数据导入脚本与五店初始样例

**Files:**
- Add: `data/store-master-profiles/hetang-five-stores.initial.json`
- Add: `scripts/import-store-master-profiles.ts`
- Add: `src/import-store-master-profiles-script.ts`
- Test: `src/import-store-master-profiles-script.test.ts`

**Step 1: Write the failing test**

- 新增导入脚本测试
- 使用一份最小 JSON fixture，断言脚本能把五店主数据导入 PG
- 断言字段至少覆盖：
  - `store_name`
  - `opening_date`
  - `area_m2`
  - `service_hours_json`
  - `city_name`
  - `longitude`
  - `latitude`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/import-store-master-profiles-script.test.ts`

Expected:

- FAIL，因为当前没有导入脚本和样例文件

**Step 3: Write minimal implementation**

- 新建 checked-in JSON 样例
- 新建脚本入口
- 对字段做最小校验：
  - 门店唯一标识
  - 日期格式
  - 数值格式
  - 经纬度合法性

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/import-store-master-profiles-script.test.ts`

Expected:

- PASS，后续新增门店或纠正门店台账时有统一导入口

**Step 5: Commit**

```bash
git add data/store-master-profiles/hetang-five-stores.initial.json scripts/import-store-master-profiles.ts src/import-store-master-profiles-script.ts src/import-store-master-profiles-script.test.ts
git commit -m "feat: add store master profile import flow"
```

### Task 3: 增加派生特征构建器，把主数据转成算法特征

**Files:**
- Add: `src/store-master-profile.ts`
- Test: `src/store-master-profile.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

- 为 `buildStoreMasterDerivedFeatures()` 增加测试
- 断言可稳定产出：
  - `store_age_months`
  - `lifecycle_stage`
  - `service_window_hours`
  - `night_window_hours`
  - `late_night_capable`
  - `store_scale_band`
  - `capacity_prior`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store-master-profile.test.ts`

Expected:

- FAIL，因为当前没有统一的门店主数据特征构建器

**Step 3: Write minimal implementation**

- 在 `src/store-master-profile.ts` 中实现纯函数构建器
- 规则必须 deterministic
- 明确：
  - 哪些是硬约束
  - 哪些只是 soft prior
  - 哪些只给解释层

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store-master-profile.test.ts`

Expected:

- PASS，物理字段开始真正进入算法消费层

**Step 5: Commit**

```bash
git add src/store-master-profile.ts src/store-master-profile.test.ts src/types.ts
git commit -m "feat: derive store master profile features"
```

### Task 4: 增加外部观察批次与 observation 层

**Files:**
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 在 `src/store.test.ts` 增加 observation 层测试
- 断言可创建并读写：
  - `store_external_observation_batches`
  - `store_external_observations`
- 断言 observation 记录支持：
  - `truth_level`
  - `confidence`
  - `source_platform`
  - `evidence_document_id`
  - `not_for_scoring`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store external observations with capture batches"`

Expected:

- FAIL，因为当前只有 context 发布层，没有 observation 底层

**Step 3: Write minimal implementation**

- 新增 batch 表与 observation 表
- 新增 owner store 方法：
  - `createStoreExternalObservationBatch()`
  - `insertStoreExternalObservation()`
  - `listStoreExternalObservations()`
- 保持和 `store_external_context_entries` 分层，不混写

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists store external observations with capture batches"`

Expected:

- PASS，外部数据进入标准化观察层

**Step 5: Commit**

```bash
git add src/store.ts src/types.ts src/store.test.ts
git commit -m "feat: add store external observation storage"
```

### Task 5: 给现有原始外部文档表补门店作用域

**Files:**
- Modify: `src/store.ts`
- Modify: `src/app/external-intelligence-service.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 `external_source_documents` 可记录门店作用域
- 断言可保存：
  - `scope_type`
  - `org_id`
  - `platform_store_id`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "stores scoped external source documents for store intelligence"`

Expected:

- FAIL，因为当前文档表偏 HQ 全局情报

**Step 3: Write minimal implementation**

- 扩展 `external_source_documents`
- 在 service 层允许门店局部文档写入
- 保持 HQ 路径兼容，不破坏现有外部情报简报

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "stores scoped external source documents for store intelligence"`

Expected:

- PASS，原始证据层与门店作用域建立关联

**Step 5: Commit**

```bash
git add src/store.ts src/app/external-intelligence-service.ts src/store.test.ts
git commit -m "feat: scope external source documents to stores"
```

### Task 6: 增加评论明细表，承接美团 / 小红书 / 抖音评论

**Files:**
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 在 `src/store.test.ts` 增加评论明细测试
- 断言存在 `external_review_items`
- 断言支持写入：
  - 原文
  - 清洗文本
  - 评分
  - 平台
  - 门店
  - 发布时间
  - 情绪标签
  - 主题标签

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "persists external review items for store intelligence"`

Expected:

- FAIL，因为当前没有统一评论明细层

**Step 3: Write minimal implementation**

- 新增评论明细表与索引
- 新增 owner store 方法：
  - `insertExternalReviewItem()`
  - `listExternalReviewItems()`
- 先不做向量化，只先把明细存稳

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "persists external review items for store intelligence"`

Expected:

- PASS，评论文本有正式数据库落点

**Step 5: Commit**

```bash
git add src/store.ts src/types.ts src/store.test.ts
git commit -m "feat: add external review item storage"
```

### Task 7: 把 observation + master profile 发布到现有 context 层

**Files:**
- Modify: `src/store-external-context.ts`
- Modify: `src/store-query.ts`
- Modify: `src/query-engine-renderer.ts`
- Modify: `src/weekly-report.ts`
- Test: `src/store-query.test.ts`
- Test: `src/query-engine-renderer.test.ts`
- Test: `src/weekly-report.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证运行时输出能读取：
  - 门店主数据派生特征
  - 发布后的 observation 摘要
- 验证仍保持：
  - `confirmed` 不被 `estimated` 覆盖
  - `research_note` 只进解释层

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store-query.test.ts src/query-engine-renderer.test.ts src/weekly-report.test.ts`

Expected:

- FAIL，因为当前读链还不知道 master profile 与 observation 层

**Step 3: Write minimal implementation**

- 在 assembler 层增加发布逻辑
- 只发布 AI 真正需要的受控字段
- 避免直接暴露原始评论全文和未经校验的杂项字段

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store-query.test.ts src/query-engine-renderer.test.ts src/weekly-report.test.ts`

Expected:

- PASS，现有查询、周报、解释链能读取新层

**Step 5: Commit**

```bash
git add src/store-external-context.ts src/store-query.ts src/query-engine-renderer.ts src/weekly-report.ts src/store-query.test.ts src/query-engine-renderer.test.ts src/weekly-report.test.ts
git commit -m "feat: publish store master data and observations to read paths"
```

### Task 8: 把门店主数据特征接入环境上下文与 customer growth

**Files:**
- Modify: `src/customer-growth/environment-context.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`
- Modify: `src/world-model/state.ts`
- Test: `src/environment-context.test.ts`
- Test: `src/reactivation-queue.test.ts`
- Test: `src/world-model/state.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证：
  - `service_hours_json` 会影响 `lateNightCapable`
  - `store_scale_band / capacity_prior` 会影响 reactivation capacity prior
  - world model state 能包含主数据派生特征与 observation 摘要

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/environment-context.test.ts src/reactivation-queue.test.ts src/world-model/state.test.ts`

Expected:

- FAIL，因为这些路径当前主要依赖手填 config 和有限外部上下文

**Step 3: Write minimal implementation**

- 在环境上下文中优先读取发布后的主数据特征
- 在 customer growth 中使用这些特征做 bounded soft adjustment
- 保持：
  - 不引入第二套 runtime
  - 不让外部弱信号主导主排序

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/environment-context.test.ts src/reactivation-queue.test.ts src/world-model/state.test.ts`

Expected:

- PASS，门店物理数据开始实质性进入算法层

**Step 5: Commit**

```bash
git add src/customer-growth/environment-context.ts src/customer-growth/reactivation/queue.ts src/world-model/state.ts src/environment-context.test.ts src/reactivation-queue.test.ts src/world-model/state.test.ts
git commit -m "feat: use store master data in environment and growth logic"
```

### Task 9: 增加平台采集作业契约与导入落点

**Files:**
- Add: `src/store-intelligence-acquisition.ts`
- Add: `src/store-intelligence-acquisition.test.ts`
- Modify: `src/app/external-intelligence-service.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

- 为采集契约增加测试
- 断言系统能表达：
  - `official_api`
  - `merchant_export`
  - `authorized_browser`
  - `manual_research`
- 断言每个作业都能落到 batch、document、observation、review 四层之一

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store-intelligence-acquisition.test.ts`

Expected:

- FAIL，因为当前还没有门店平台采集统一契约

**Step 3: Write minimal implementation**

- 新建 acquisition contract 模块
- 定义作业输入、平台类型、抓取模式、写库目标
- 先不真正接高德 / 美团 / 小红书采集，只把落库契约和 owner path 定下来

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store-intelligence-acquisition.test.ts`

Expected:

- PASS，后续接自动采集时不会再临时设计数据去向

**Step 5: Commit**

```bash
git add src/store-intelligence-acquisition.ts src/store-intelligence-acquisition.test.ts src/app/external-intelligence-service.ts src/types.ts
git commit -m "feat: add store intelligence acquisition contract"
```

### Task 10: 完成端到端回归验证

**Files:**
- Verify only

**Step 1: Run focused storage tests**

Run:

```bash
pnpm exec vitest run src/store.test.ts src/import-store-master-profiles-script.test.ts src/store-master-profile.test.ts src/store-intelligence-acquisition.test.ts
```

Expected:

- PASS，数据底座相关测试全部通过

**Step 2: Run focused read-path tests**

Run:

```bash
pnpm exec vitest run src/store-query.test.ts src/query-engine-renderer.test.ts src/weekly-report.test.ts src/environment-context.test.ts src/reactivation-queue.test.ts src/world-model/state.test.ts
```

Expected:

- PASS，新数据层对现有输出面兼容

**Step 3: Run repo TypeScript check**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`

Expected:

- 若失败，需明确区分本次新增错误与仓库既有错误

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add store master data and external intelligence foundation"
```

---

Plan complete and saved to `docs/plans/2026-04-21-store-master-data-and-external-intelligence-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
