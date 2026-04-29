# Customer Identity Context Gender Marital Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `htops` 的顾客经营画像补上 `gender / marital_status` 两个受治理的身份上下文字段，并把它们安全接入 `observation -> signal -> operating profile -> read surface -> doctor` 主链。

**Architecture:** 保持当前 `PostgreSQL truth source + customer-growth owner modules + bounded read surfaces` 路线，不新开 demographic runtime。第一阶段先补标准值治理、画像快照、证据展示与质量闭环，显式保持 `action-profile-bridge` 和 deterministic 主评分不变。

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, current `src/customer-growth/`, `src/world-model/`, `src/ops/doctor.ts`, profile/query rendering modules

---

### Task 1: 增加 identity context 的字段治理 owner

**Files:**
- Add: `src/customer-growth/identity-context.ts`
- Add: `src/customer-growth/identity-context.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

- 增加测试，验证：
  - `gender` 原始输入可以归一到 `male / female / other / unknown / undisclosed`
  - `marital_status` 原始输入可以归一到 `single / married / divorced / widowed / other / unknown / undisclosed`
  - 每个字段都有显式 policy：
    - 是否允许进入 profile snapshot
    - 是否允许弱信号提升为稳定画像
    - 是否允许 action layer 直接消费

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/identity-context.test.ts`

Expected:

- FAIL，因为当前还没有 identity context 的 owner helper 和统一策略

**Step 3: Write minimal implementation**

- 在 `src/types.ts` 增加最小类型：
  - `CustomerIdentityContextField`
  - `CustomerGenderValue`
  - `CustomerMaritalStatusValue`
- 在 `src/customer-growth/identity-context.ts` 增加：
  - 原始值归一化 helper
  - 字段 policy helper
  - 是否允许进入 snapshot 的规则
- 第一版只做 `gender / marital_status`，不要提前扩展更多人口属性

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/identity-context.test.ts`

Expected:

- PASS，identity context 的值域和使用边界有 owner 定义

### Task 2: 把 identity context 信号接入 operating profile snapshot

**Files:**
- Modify: `src/customer-growth/customer-operating-profile.ts`
- Modify: `src/customer-growth/customer-operating-profile.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证：
  - `identity_context|gender`
  - `identity_context|marital_status`
  - 可以被写入 `identityProfileJson`
- 验证 snapshot 至少保留：
  - 规范化后的字段值
  - `truth_boundary`
  - `confidence`
  - `confidence_discount`
  - `source_role`
  - `observed_at`
- 验证弱信号不会在 policy 不允许时提升成稳定画像值

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/customer-operating-profile.test.ts -t "identity context"`

Expected:

- FAIL，因为当前 snapshot builder 还没有读取 identity context signals

**Step 3: Write minimal implementation**

- 在 `src/customer-growth/customer-operating-profile.ts`：
  - 读取 `identity_context|gender`
  - 读取 `identity_context|marital_status`
  - 通过 `identity-context` owner 做标准化和 promotion 判断
  - 将结果写入 `identityProfileJson`
- 保持当前 8 域结构不变，不单独新建第二套画像结构

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/customer-operating-profile.test.ts -t "identity context"`

Expected:

- PASS，daily profile snapshot 已纳入受治理的身份上下文

### Task 3: 扩展 customer observation 的主链覆盖

**Files:**
- Modify: `src/customer-growth/customer-observation.test.ts`
- Modify: `src/customer-growth/observation-capture.test.ts`
- Modify: `src/customer-growth/customer-observation.ts`

**Step 1: Write the failing test**

- 增加 observation 测试，验证：
  - `identity_context|gender` 在 `hard_fact` 与 `observed_fact` 下能稳定归一
  - 更强来源会压过弱推断
  - `marital_status` 的 `predicted_signal` 不会被误当作稳定主值
- 增加 capture 测试，验证手工写入 identity context observation 时：
  - batch / observation / signal 仍按现有 owner path 生成

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/customer-observation.test.ts src/customer-growth/observation-capture.test.ts`

Expected:

- FAIL，因为当前还没有 identity context 的主链覆盖和专项边界

**Step 3: Write minimal implementation**

- 在 `src/customer-growth/customer-observation.ts` 为 identity context 加最小专项规则：
  - 复用通用 weight 逻辑
  - 但在 promotion 到 snapshot 时服从 `identity-context` owner policy
- 保持 observation capture 入口通用，不为这两个字段单独开入口

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/customer-observation.test.ts src/customer-growth/observation-capture.test.ts`

Expected:

- PASS，identity context 已纳入 observation 主链，但没有破坏通用 capture 机制

### Task 4: 把 identity context 接入 profile read surface 与 world model evidence

**Files:**
- Modify: `src/world-model/customer-profile-evidence.ts`
- Modify: `src/world-model/customer-profile-evidence.test.ts`
- Modify: `src/customer-growth/profile.ts`
- Modify: `src/customer-profile.test.ts`
- Modify: `src/customer-query.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证顾客画像查询可以展示：
  - `gender`
  - `marital_status`
  - 对应 truth boundary / confidence boundary
- 增加 world model evidence 测试，验证：
  - `identity.gender`
  - `identity.marital_status`
  - 可以生成 evidence item
- 验证弱信号仍会被标成 `weak_signal / tentative`，不会渲染成确定事实

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/world-model/customer-profile-evidence.test.ts src/customer-profile.test.ts src/customer-query.test.ts`

Expected:

- FAIL，因为当前 read surface 和 world model evidence 还没有 identity context 展示

**Step 3: Write minimal implementation**

- 在 `src/world-model/customer-profile-evidence.ts` 新增：
  - `identity.gender`
  - `identity.marital_status`
- 在 `src/customer-growth/profile.ts`：
  - 增加 evidence label
  - 增加结构化 profile 渲染
- 保持 explanation 只读，不反向改写事实层

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/world-model/customer-profile-evidence.test.ts src/customer-profile.test.ts src/customer-query.test.ts`

Expected:

- PASS，identity context 已被 profile/world model 读链消费

### Task 5: 明确禁止 action bridge 直接消费 identity context

**Files:**
- Modify: `src/customer-growth/action-profile-bridge.test.ts`
- Optionally Modify: `src/customer-growth/action-profile-bridge.ts`

**Step 1: Write the failing test**

- 增加测试，验证：
  - 即使 `identityProfileJson` 包含 `gender / marital_status`
  - `buildMemberActionProfileBridge` 的 `reasonTags / touchHints / actionBoostScore`
  - 仍不因这两个字段发生变化

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/action-profile-bridge.test.ts -t "ignores identity context"`

Expected:

- FAIL，因为当前还没有显式测试冻结这条边界

**Step 3: Write minimal implementation**

- 如有必要，在 `src/customer-growth/action-profile-bridge.ts` 增加最小保护注释或 guard
- 不新增任何基于 `gender / marital_status` 的 priority 逻辑

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/action-profile-bridge.test.ts -t "ignores identity context"`

Expected:

- PASS，动作桥边界被显式锁住

### Task 6: 将 identity context 接入 doctor / quality summary

**Files:**
- Modify: `src/ops/doctor.ts`
- Modify: `src/ops/doctor.test.ts`
- Optionally Modify: `src/app/admin-read-service.ts`
- Optionally Modify: `src/app/admin-read-service.test.ts`

**Step 1: Write the failing test**

- 增加测试，验证 doctor 可以汇总：
  - `identity_context_missing`
  - `identity_context_conflict`
  - `identity_context_stale`
- 如果 admin read 已有 profile quality 摘要入口，补测试验证它能读取这些统计

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/ops/doctor.test.ts src/app/admin-read-service.test.ts`

Expected:

- FAIL，因为当前 doctor taxonomy 还没有 identity context 质量项

**Step 3: Write minimal implementation**

- 在 `src/ops/doctor.ts` 增加最小 taxonomy：
  - 缺失
  - 冲突
  - 过期
- 如果 admin read 已有相应摘要面，则最小接线；如果没有，不新增新入口

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/ops/doctor.test.ts src/app/admin-read-service.test.ts`

Expected:

- PASS，doctor / admin read 能看到 identity context 的质量闭环

### Task 7: 全链回归与文档回写

**Files:**
- Modify: `docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md`
- Modify: `docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md`

**Step 1: Run targeted regression suite**

Run: `pnpm exec vitest run src/customer-growth/identity-context.test.ts src/customer-growth/customer-observation.test.ts src/customer-growth/observation-capture.test.ts src/customer-growth/customer-operating-profile.test.ts src/world-model/customer-profile-evidence.test.ts src/customer-profile.test.ts src/customer-query.test.ts src/customer-growth/action-profile-bridge.test.ts src/ops/doctor.test.ts src/app/admin-read-service.test.ts`

Expected:

- PASS，identity context 主链与边界测试全部通过

**Step 2: Update plan progress notes**

- 在 full-stack 和 customer profile 两份现有计划里补回写：
  - `gender / marital_status` 已以受治理 identity context 入链
  - 第一阶段仍未进入 action bridge / deterministic scoring

**Step 3: Run lightweight verification**

Run: `rg -n "identity context|gender|marital_status|action bridge" docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md`

Expected:

- 能检索到本轮回写和边界说明

Plan complete and saved to `docs/plans/2026-04-22-customer-identity-context-gender-marital-implementation-plan.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints
