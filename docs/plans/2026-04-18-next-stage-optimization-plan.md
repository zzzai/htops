# Next-Stage Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在当前主链已稳定的基础上，把 `htops` 从“可运行、可观测”继续收成“可持续运营、可按部署窗口验收、可按真实失败样本迭代”的状态。

**Architecture:** 不改主执行骨架，继续沿 `Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action` 收口。后续优化只允许落在 owner modules、semantic quality、conversation semantic state、analysis lens 质量，不扩 `runtime.ts`，不引入第二套 ontology runtime。

**Tech Stack:** TypeScript, FastAPI/Python, PostgreSQL, Vitest, systemd, existing Hetang bridge / doctor / query-api / semantic-quality owners

---

## 当前基线

截至 2026-04-18，已经确认：

- `scheduler / queue / doctor / query-api` 控制面已基本收口
- `semantic quality` 已具备：
  - 结构化 summary
  - backlog
  - sample candidates
  - `doctor` 展示
  - Query API 读面
  - `occurred_after` 部署后窗口过滤
- `analysis lens` 已稳定覆盖单店：
  - `CGO/CMO`
  - `COO`
  - `CFO`
- `scheduled worker` 主生产链路未被新一轮优化打断

后续优化的核心约束：

1. 只基于 **新 live 样本** 决定是否改行为，不为了旧 24h 聚合去乱修
2. 不自动猜测存在事实歧义的经营口语金额问法
3. 不扩散到新基础设施，优先 owner modules 与质量闭环

---

## 优先级 1：把“部署后窗口验收”制度化

**目标：** 让每次上线后都能快速回答“这轮有没有新增失败”，减少 24h 聚合对判断的干扰。

**Why now:**

- 当前 `occurred_after` 已经可用
- 但还缺少稳定的上线后验收操作习惯和统一口径

**Owner modules / surfaces:**

- `api/main.py`
- `src/app/admin-read-service.ts`
- `src/ops/doctor.ts`
- `docs/plans/2026-04-16-control-plane-production-acceptance-checklist.md`

**Implementation tasks:**

### Task 1.1：定义统一的 deploy-window 验收口径

**Files:**
- Modify: `docs/plans/2026-04-16-control-plane-production-acceptance-checklist.md`

**Step 1:** 增加“部署后窗口验收”章节  
内容包括：

- 如何确定 `occurred_after`
- 哪些 endpoint / command 必查
- 哪些指标归零才算新窗口稳定

**Step 2:** 约定 3 类必查面

- `doctor`
- `/api/v1/runtime/semantic-quality`
- `日报 send_status / upgrade telemetry`

**Step 3:** 文档中明确验收完成标准

- deploy-window 内 `entry_unresolved / generic_unmatched / semantic_failure = 0`
- deploy-window 内无新的 `alert-only`
- `10:00` 日报当日正常完成

### Task 1.2：为值班增加最小操作模板

**Files:**
- Modify: `docs/plans/2026-04-16-control-plane-production-acceptance-checklist.md`

**Step 1:** 加入固定命令模板

```bash
pnpm cli -- hetang doctor | tail -n 20
curl -sf 'http://127.0.0.1:18890/api/v1/runtime/semantic-quality?occurred_after=<DEPLOY_ISO>' | jq '.'
```

**Step 2:** 明确“看 24h 聚合”和“看 deploy-window”分别回答什么问题

---

## 优先级 2：只打 deploy-window 内新增的语义失败

**目标：** 从“修历史问题”切换为“只修当前线上新增真实缺口”。

**Why now:**

- 当前观测已经足够
- 不需要再先补更多 telemetry

**Owner modules:**

- `src/semantic-intent.ts`
- `src/query-intent.ts`
- `src/capability-graph.ts`
- `src/app/conversation-semantic-state-service.ts`

**Implementation tasks:**

### Task 2.1：建立 deploy-window top failure 处理规则

**Files:**
- Modify: `docs/plans/2026-04-18-next-stage-optimization-plan.md`

**Step 1:** 约定只处理这三类 failure：

- `entry_unresolved`
- `generic_unmatched`
- `semantic_failure`

**Step 2:** 约定 `clarify_missing_metric` 的处理边界

- 若问题本身存在明确金额歧义，则允许保守 clarify
- 只有“业务意图能稳定落到标准能力”时，才允许升级为 query / analysis

### Task 2.2：每次修复必须绑定 live prompt 样本

**Files:**
- Modify: `src/semantic-optimization-playbook.json`
- Modify: `src/semantic-optimization-playbook.test.ts`

**Step 1:** 每次新增修复都必须把真实 prompt 落入 playbook 样本集

**Step 2:** 样本必须带 owner module，不允许再出现“知道失败多，但不知道该改哪里”

---

## 优先级 3：把 conversation semantic state 从 clarify carry 扩到复合问法

**目标：** 提升多轮、老板式口语、topic switch 的稳定性，但不破坏确定性主链。

**Why now:**

- 当前 time/store/metric clarify carry 已经有基础
- 下一阶段最值钱的是复合问法延续，而不是再堆更多 prompt

**Owner modules:**

- `src/query-intent.ts`
- `src/semantic-intent.ts`
- `src/app/conversation-semantic-state-service.ts`
- `src/app/message-entry-service.ts`

**Implementation tasks:**

### Task 3.1：补“老板式口语 + 第二句补槽”回收

**Files:**
- Modify: `src/query-intent.test.ts`
- Modify: `src/semantic-intent.test.ts`
- Modify: `src/app/conversation-semantic-state-service.test.ts`
- Modify: `src/query-intent.ts`

**Step 1:** 先写 failing tests，覆盖：

- “这几天义乌店怎么样” -> 第二句补“重点看留存”
- “五店近7天重点看什么” -> 第二句补“从利润角度”
- “先看义乌店” -> 第二句改问“五店整体”

**Step 2:** 只扩 bounded carry 规则

- 支持补 object / action / lens hint
- 明确 topic switch reset

**Step 3:** 跑 targeted tests，确认旧 clarify carry 不回退

### Task 3.2：把 carried state 显式记成可审计字段

**Files:**
- Modify: `src/types.ts`
- Modify: `src/app/conversation-semantic-state-service.ts`
- Modify: `src/app/message-entry-service.ts`

**Step 1:** 增补最小状态字段：

- `lastLensHint`
- `lastScopeKind`
- `lastTopicClass`

**Step 2:** 只作为语义继承参考，不允许绕过主路由

---

## 优先级 4：继续提升 analysis lens 的“有价值输出”质量

**目标：** 让 `COO / CFO / CGO/CMO` 不只是路由正确，还要输出更像经营负责人能直接拿去用的内容。

**Why now:**

- 当前 lens 路由已经通了
- 下一阶段瓶颈开始从“进错路”转向“输出价值不够高”

**Owner modules:**

- `src/analysis-lens.ts`
- `src/query-engine-renderer.ts`
- `src/query-engine.ts`

**Implementation tasks:**

### Task 4.1：补 lens-specific action fallback

**Files:**
- Modify: `src/analysis-lens.test.ts`
- Modify: `src/query-engine-semantic-quality.test.ts`
- Modify: `src/analysis-lens.ts`

**Step 1:** 先写 failing tests，覆盖：

- CFO 输出在利润字段缺失时，不回落成泛运营建议
- COO 输出优先给排班/承接动作
- HQ 仍不硬上 CFO/COO，除非字段充分性确认通过

**Step 2:** 增加 bounded fallback 策略

- CFO：优先会员资产寿命、续费压力、耗卡/充值关系
- COO：优先承接效率、加钟收口、排班负荷

### Task 4.2：建立 HQ lens readiness checklist

**Files:**
- Create: `docs/plans/2026-04-18-hq-lens-readiness-checklist.md`

**Step 1:** 列清楚 HQ `CFO / COO` 需要哪些稳定字段

**Step 2:** 未满足前，不进入 HQ 新 persona 开发

---

## 优先级 5：给 semantic quality 加“版本 / 部署标记”能力

**目标：** 让部署窗口查询不再依赖手输时间戳。

**Why now:**

- 现在 `occurred_after` 已经能解决问题
- 但手输 ISO 时间仍然容易出错，适合作为下一个低风险提效项

**Owner modules:**

- `src/types.ts`
- `src/app/semantic-quality-service.ts`
- `src/store/semantic-execution-audit-store.ts`
- `api/main.py`

**Implementation tasks:**

### Task 5.1：为 semantic audit 增补 deploy marker

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/semantic-execution-audit-store.ts`
- Modify: `src/app/semantic-quality-service.ts`

**Step 1:** 增加可选字段：

- `deployMarker`
- `servingVersion`

**Step 2:** 写入 query / inbound 语义审计

### Task 5.2：Query API 支持按 deploy marker 过滤

**Files:**
- Modify: `api/main.py`
- Modify: `api/test_main.py`

**Step 1:** 新增 query param

- `deploy_marker`

**Step 2:** 与 `occurred_after` 并存，不破坏已有接口

---

## 优先级 6：把“优化完成”的停线标准写清楚

**目标：** 防止项目一直优化下去，没有明确完成边界。

**Completion criteria:**

满足以下 5 条，即可认为“这一轮真正优化完成”：

1. 连续 3 个工作日，`10:00` 日报全部 `sent`，无新增 `alert-only`
2. 连续 3 个工作日，deploy-window 内 `entry_unresolved / generic_unmatched / semantic_failure = 0`
3. `doctor`、Query API、semantic quality backlog 对同一问题给出一致 owner 指向
4. `semantic optimization playbook` 不再存在多份漂移定义
5. 新增优化只基于 live 样本，不再为旧聚合数字盲修

---

## 推荐执行顺序

按投入产出排序，建议就按下面顺序继续：

1. 部署后窗口验收制度化
2. 只打 deploy-window 内新增 failure
3. conversation semantic state 扩到复合问法
4. analysis lens 输出质量提升
5. semantic audit 增加 deploy marker
6. 写清停线标准并执行 3 天观察期

---

## 不建议现在做的事

当前不建议继续做：

- 引入 Redis 作为默认优化手段
- 做 HQ `CFO / COO` 新 persona，除非先过字段充分性检查
- 把 AI 提升成第一层默认路由
- 为“盘里收了多少”这类歧义金额口语强行自动猜指标
- 新起 ontology runtime / memory runtime

这些都属于 ROI 低或风险高，不适合当前阶段。
