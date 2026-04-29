# 迎宾店旧 MySQL 导入 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将迎宾店旧 MySQL 核心历史数据导入现有 PostgreSQL 数仓，并复用现有历史快照、画像、召回重建链路。

**Architecture:** 新增一个旧 MySQL 导入模块，按映射规则把旧表记录转换为现有事实表记录。导入期间关闭逐批物化视图刷新，所有事实写完后统一重建视图与衍生层。

**Tech Stack:** TypeScript, Vitest, mysql2, PostgreSQL, pg-mem, existing `HetangOpsStore`

---

### Task 1: 建立测试骨架与映射约束

**Files:**
- Create: `src/legacy-mysql-import.test.ts`
- Modify: `package.json`
- Test: `src/legacy-mysql-import.test.ts`

**Step 1: Write the failing test**

覆盖以下行为：

- 能把 `res_member_card_create` 映射成 `MemberCurrentRecord`
- 能把 `res_member_card_create` 映射成 `MemberCardCurrentRecord`
- 能把 `res_member_card_createbak` 折叠成按天快照
- 能把 `exe_member_recharge` 映射成 `RechargeBillRecord`
- 能把 `exe_consumeritems` 映射成 `ConsumeBillRecord`
- 能把 `exe_settlement_detail` 中会员卡扣减映射成 `UserTradeRecord`
- 能对 `wwdb` 与 `2` 的重复记录按业务键去重

**Step 2: Run test to verify it fails**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: FAIL with missing module / missing exports

**Step 3: Add dependency entry**

在 `package.json` 中增加：

- dependency: `mysql2`

**Step 4: Re-run test**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: Still FAIL, but now because implementation is missing, not because imports cannot resolve

### Task 2: 实现纯映射函数

**Files:**
- Create: `src/legacy-mysql-import.ts`
- Test: `src/legacy-mysql-import.test.ts`

**Step 1: Write the failing test**

补充一组精确测试：

- 构造旧会员卡行，断言生成的 `raw_json` 可被现有快照逻辑回读
- 构造同卡同天两条 `createbak` 行，断言保留最后一条
- 构造 `CANCELFLAG=1` 的充值和消费，断言 `antiFlag=true`

**Step 2: Run test to verify it fails**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: FAIL with specific assertion failures

**Step 3: Write minimal implementation**

在 `src/legacy-mysql-import.ts` 中新增：

- legacy row types
- `deriveLegacyMemberId`
- `mapLegacyMemberCurrentRow`
- `mapLegacyMemberCardRow`
- `buildLegacySnapshotRows`
- `mapLegacyRechargeRow`
- `mapLegacyConsumeRow`
- `mapLegacyUserTradeRow`
- `dedupeByKey`

**Step 4: Run test to verify it passes**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: PASS

### Task 3: 实现 MySQL 读取与批量写入执行器

**Files:**
- Modify: `src/legacy-mysql-import.ts`
- Test: `src/legacy-mysql-import.test.ts`

**Step 1: Write the failing test**

新增执行器测试，覆盖：

- 导入执行器会按顺序调用 `upsertMemberCurrent`
- 然后调用 `upsertMemberCards`
- 然后调用 `upsertRechargeBills`
- 然后调用 `upsertConsumeBills`
- 然后调用 `upsertUserTrades`
- 最后只触发一次重建，不进行逐批刷新

**Step 2: Run test to verify it fails**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: FAIL with call order mismatch or missing executor

**Step 3: Write minimal implementation**

实现：

- `createLegacyMysqlPool`
- `readLegacyYingbinRows`
- `importLegacyYingbinIntoStore`

要求：

- 默认读取 `wwdb` 与 `2`
- 支持限制日期范围
- 读取时按批次分页
- 执行时只在最后调用统一刷新/重建

**Step 4: Run test to verify it passes**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: PASS

### Task 4: 增加 CLI 导入脚本

**Files:**
- Create: `scripts/import-legacy-yingbin.ts`
- Modify: `src/store.ts`
- Test: `src/legacy-mysql-import.test.ts`

**Step 1: Write the failing test**

为脚本参数解析新增测试或最小可测函数：

- 支持 `--mysql-host`
- 支持 `--mysql-port`
- 支持 `--mysql-user`
- 支持 `--org-id`
- 支持 `--start`
- 支持 `--end`
- 支持 `--dry-run`

**Step 2: Run test to verify it fails**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: FAIL with parse function missing

**Step 3: Write minimal implementation**

脚本职责：

- 加载现有 `htops` 配置
- 连接 PostgreSQL
- 初始化 `HetangOpsStore`
- 调用导入执行器
- 调用历史重建脚本函数
- 统一触发一次视图重建

同时在 `src/store.ts` 中新增一个可选批量写入接口，避免 `upsertConsumeBills` / `upsertTechUpClockRows` 这类方法内置的逐次 refresh 干扰导入。

建议最小改法：

- 为相关 upsert 方法增加 `options?: { refreshViews?: boolean }`

**Step 4: Run test to verify it passes**

Run: `npm test -- src/legacy-mysql-import.test.ts`

Expected: PASS

### Task 5: 校验现有链路兼容性

**Files:**
- Modify: `src/store.test.ts`
- Modify: `src/customer-history-backfill.test.ts`
- Test: `src/store.test.ts`
- Test: `src/customer-history-backfill.test.ts`

**Step 1: Write the failing test**

新增回归测试：

- `fact_member_daily_snapshot.raw_json` 兼容旧导入结构
- 导入后的 `raw_json` 仍可被 `normalizeMemberRow` / `normalizeMemberCardRows` 识别
- 批量导入模式不会导致每次 fact upsert 都触发物化视图 refresh

**Step 2: Run test to verify it fails**

Run: `npm test -- src/store.test.ts src/customer-history-backfill.test.ts src/legacy-mysql-import.test.ts`

Expected: FAIL with compatibility or refresh assertions

**Step 3: Write minimal implementation**

修正：

- `raw_json` 结构
- store 批量 refresh 开关
- 导入后统一 rebuild 调用

**Step 4: Run test to verify it passes**

Run: `npm test -- src/store.test.ts src/customer-history-backfill.test.ts src/legacy-mysql-import.test.ts`

Expected: PASS

### Task 6: 本地干跑与实导验证

**Files:**
- Modify: `scripts/import-legacy-yingbin.ts`

**Step 1: Dry run**

Run:

```bash
node --import tsx scripts/import-legacy-yingbin.ts \
  --mysql-host 127.0.0.1 \
  --mysql-port 13307 \
  --mysql-user root \
  --org-id 627149864218629 \
  --dry-run
```

Expected:

- 能连通恢复容器
- 输出各源表读取量、去重量、目标写入量

**Step 2: Real import**

Run:

```bash
node --import tsx scripts/import-legacy-yingbin.ts \
  --mysql-host 127.0.0.1 \
  --mysql-port 13307 \
  --mysql-user root \
  --org-id 627149864218629
```

Expected:

- 成功写入 PostgreSQL
- 只在末尾执行一次统一刷新 / 重建

**Step 3: Verify rebuilt data**

Run:

```bash
node --import tsx scripts/backfill-customer-history.ts --start 2022-04-05 --end 2025-01-01 --org 627149864218629
```

Expected:

- snapshots / intelligence / reactivation rebuild success

**Step 4: Spot check**

验证以下查询结果明显增强：

- 迎宾店高价值待唤回名单
- 迎宾店过去 30 天最值得跟进会员
- 迎宾店历史储值轨迹特征

