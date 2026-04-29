# Customer Operating Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `htops` 增加生产级“顾客经营画像”底座，把服务过程 observation、关系记忆、偏好与服务诉求正式接入 customer growth / world model / 经营动作引擎。

**Architecture:** 保持 `PostgreSQL truth source + owner modules + bounded action bridge` 路线，不新开画像平台。先补 observation -> signals -> daily profile snapshot，再把稳定画像特征接入 query、strategy、queue 和 world model；主分层继续由 deterministic 硬事实主导。

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, current `src/customer-growth/`, `src/world-model/`, query/profile rendering modules

## 2026-04-21 进度回写

- `Task 1`：completed
- `Task 2`：completed
- `Task 3`：completed
- `Task 4`：completed
- `Task 5`：completed
- `Task 6`：completed
- `Task 7`：completed
- `Task 8`：completed

本轮已经正式进入主链的能力：

- observation 存储、signal 归一化、daily profile snapshot
- 顾客画像查询的证据边界展示
- `strategy / queue / intelligence` 的 bounded action bridge
- `world model customer_state` 的画像证据入口
- nightly review / semantic quality 的顾客画像信号闭环

仍待后续波次的部分：

- observation 统一采集入口
- 更丰富的画像字段域
- `world model` read surface 的全量消费
- HQ / weekly 的画像聚合叙事

---

### Task 1: 增加顾客经营画像的核心类型

**Files:**
- Modify: `src/types.ts`
- Test: `src/customer-operating-profile-types.test.ts`

**Step 1: Write the failing test**

- 新增类型测试，验证以下类型存在且边界明确：
  - `CustomerObservationTruthBoundary`
  - `CustomerObservationSourceType`
  - `CustomerServiceObservationRecord`
  - `CustomerOperatingSignalRecord`
  - `CustomerOperatingProfileDailyRecord`
- 验证 observation、signal、profile snapshot 三层不会混成一个结构

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-operating-profile-types.test.ts`

Expected:

- FAIL，因为当前类型层还没有顾客经营画像的正式结构

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 中补：
  - observation truth boundary
  - source role / source type
  - signal domain / signal key
  - daily profile snapshot 类型
- 明确：
  - `hard_fact`
  - `observed_fact`
  - `inferred_label`
  - `predicted_signal`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-operating-profile-types.test.ts`

Expected:

- PASS，类型边界明确

### Task 2: 增加顾客服务 observation 的存储层

**Files:**
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Test: `src/store.test.ts`

**Step 1: Write the failing test**

- 为 store 增加测试，验证可以写入和读取：
  - `customer_service_observation_batches`
  - `customer_service_observations`
- 验证 observation 至少包含：
  - `member_id / customer_identity_key`
  - `org_id`
  - `source_role`
  - `observer_id`
  - `signal_domain`
  - `signal_key`
  - `value_json`
  - `confidence`
  - `observed_at`
  - `valid_to`
  - `raw_note`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store.test.ts -t "customer service observations"`

Expected:

- FAIL，因为当前 store 还没有顾客服务 observation 表和 owner methods

**Step 3: Write minimal implementation**

- 在 `src/store.ts` 新增两张表
- 增加 owner methods：
  - `createCustomerServiceObservationBatch`
  - `insertCustomerServiceObservation`
  - `listCustomerServiceObservations`
- 只做最小生产结构，不做 UI

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store.test.ts -t "customer service observations"`

Expected:

- PASS，observation 落点建立

### Task 3: 增加 observation -> signal 归一化 owner

**Files:**
- Add: `src/customer-growth/customer-observation.ts`
- Add: `src/customer-growth/customer-observation.test.ts`
- Modify: `src/store.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

- 增加测试，验证多条 observation 可以被归一化成稳定信号：
  - 服务诉求
  - 互动风格
  - 时段偏好
  - 技师偏好
  - 触达接受度
- 验证低置信、过期 observation 会被降权或忽略

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/customer-observation.test.ts`

Expected:

- FAIL，因为当前还没有 observation normalization owner

**Step 3: Write minimal implementation**

- 新增归一化 owner：
  - 合并多来源 observation
  - 做时间衰减
  - 输出稳定 signal rows
- 保留显式 `confidence_discount`
- 不把 observation 直接变成主分层

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/customer-observation.test.ts`

Expected:

- PASS，observation 到 signal 的桥接可用

### Task 4: 增加顾客经营画像快照构建

**Files:**
- Add: `src/customer-growth/customer-operating-profile.ts`
- Add: `src/customer-growth/customer-operating-profile.test.ts`
- Modify: `src/customer-growth/intelligence.ts`
- Modify: `src/store.ts`

**Step 1: Write the failing test**

- 增加测试，验证系统可以基于：
  - current member facts
  - customer segments
  - reactivation features
  - normalized observation signals
- 构建 `mart_customer_operating_profiles_daily`

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/customer-operating-profile.test.ts`

Expected:

- FAIL，因为当前还没有 daily operating profile snapshot builder

**Step 3: Write minimal implementation**

- 新增 snapshot builder，输出：
  - 身份层
  - 消费能力层
  - 服务需求层
  - 互动风格层
  - 偏好层
  - 场景层
  - 关系层
  - 风险机会层
- 关系层和风险层优先复用现有 `customer intelligence / reactivation features`

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/customer-operating-profile.test.ts`

Expected:

- PASS，顾客经营画像快照建成

### Task 5: 打通顾客画像读路径与证据边界展示

**Files:**
- Modify: `src/customer-growth/profile.ts`
- Modify: `src/customer-query.ts`
- Modify: `src/tools/handlers.ts`
- Test: `src/customer-profile.test.ts`
- Test: `src/customer-query.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证顾客画像查询可以展示：
  - 稳定画像快照
  - observation 来源摘要
  - 事实 / 观察 / 推断 的显式区分
- 验证低置信 observation 不会被渲染成“确定结论”

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-profile.test.ts src/customer-query.test.ts`

Expected:

- FAIL，因为当前 profile query 还没有经营画像快照和证据边界展示

**Step 3: Write minimal implementation**

- 给读路径增加 operating profile snapshot
- AI advisory 只读安全快照，不直接读 observation 原始文本
- 保持旧输出兼容，但新增更明确的证据边界字段

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-profile.test.ts src/customer-query.test.ts`

Expected:

- PASS，读路径可用

### Task 6: 把顾客经营画像正式接入经营动作引擎

**Files:**
- Modify: `src/customer-growth/reactivation/strategy.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`
- Modify: `src/customer-growth/reactivation/learning.ts`
- Modify: `src/customer-growth/intelligence.ts`
- Add: `src/customer-growth/action-profile-bridge.ts`
- Add: `src/customer-growth/action-profile-bridge.test.ts`
- Test: `src/reactivation-strategy.test.ts`
- Test: `src/reactivation-queue.test.ts`
- Test: `src/customer-intelligence.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证动作层可以吸收：
  - 服务诉求匹配
  - 时段场景匹配
  - 技师关系强度
  - 跟进渠道适配
  - observation confidence discount
- 验证这些输入：
  - 不会直接改 `primarySegment`
  - 只能做 bounded action adjustment

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/action-profile-bridge.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-intelligence.test.ts`

Expected:

- FAIL，因为当前动作层还没有顾客经营画像 bridge

**Step 3: Write minimal implementation**

- 新增 `action-profile-bridge`
- 将 operating profile snapshot 转成：
  - `time_slot_fit_adjustment`
  - `service_need_match_adjustment`
  - `relationship_strength_adjustment`
  - `channel_fit_adjustment`
  - `confidence_discount`
- strategy / queue 只吃 bounded adjustment inputs
- `customer intelligence` 继续保持 deterministic 主分层

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/action-profile-bridge.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-intelligence.test.ts`

Expected:

- PASS，Task 6 具备完整输入面

### Task 7: 打通到 world model 和夜间学习闭环

**Files:**
- Modify: `src/world-model/types.ts`
- Add: `src/world-model/customer-profile-evidence.ts`
- Add: `src/world-model/customer-profile-evidence.test.ts`
- Modify: `src/app/semantic-quality-service.ts`
- Modify: `src/app/conversation-review-service.ts`

**Step 1: Write the failing test**

- 增加测试，验证 world model customer_state 可以显式吸收：
  - 服务诉求
  - 偏好
  - 关系层 evidence
  - observation confidence boundary
- 验证 night review 可以发现：
  - 缺失 observation
  - 过期画像
  - 低命中动作建议

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/customer-profile-evidence.test.ts src/app/semantic-quality-service.test.ts src/app/conversation-review-service.test.ts`

Expected:

- FAIL，因为 world model 和 nightly learning 还没有吃到顾客经营画像层

**Step 3: Write minimal implementation**

- 给 world model customer_state 增加 operating profile evidence 入口
- 夜间学习闭环增加：
  - observation gap
  - profile freshness gap
  - action mismatch gap

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/customer-profile-evidence.test.ts src/app/semantic-quality-service.test.ts src/app/conversation-review-service.test.ts`

Expected:

- PASS，顾客经营画像正式进入 world model 和学习闭环

### Task 8: 文档回写与聚合验证

**Files:**
- Modify: `docs/plans/2026-04-21-customer-operating-profile-design.md`
- Modify: `docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md`
- Modify: `docs/plans/2026-04-21-operating-intelligence-full-stack-design.md`
- Modify: `docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md`

**Step 1: 回写阶段状态**

- 标明顾客经营画像与 Task 6 的从属关系
- 标明哪些输入已存在，哪些仍待实现

**Step 2: 运行聚合验证**

Run:

- `pnpm exec vitest run src/customer-operating-profile-types.test.ts`
- `pnpm exec vitest run src/store.test.ts -t "customer service observations"`
- `pnpm exec vitest run src/customer-growth/customer-observation.test.ts`
- `pnpm exec vitest run src/customer-growth/customer-operating-profile.test.ts`
- `pnpm exec vitest run src/customer-profile.test.ts src/customer-query.test.ts`
- `pnpm exec vitest run src/customer-growth/action-profile-bridge.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-intelligence.test.ts`
- `pnpm exec vitest run src/world-model/customer-profile-evidence.test.ts src/app/semantic-quality-service.test.ts src/app/conversation-review-service.test.ts`

Expected:

- 关键 owner path 与动作桥接链路通过

**Step 3: 汇报结果**

- 说明哪些已经实现
- 说明哪些仍是后续波次

**Step 4: Commit**

```bash
git add docs/plans/2026-04-21-customer-operating-profile-design.md \
  docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md \
  docs/plans/2026-04-21-operating-intelligence-full-stack-design.md \
  docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md
git commit -m "docs: add customer operating profile design and task 6 expansion"
```
