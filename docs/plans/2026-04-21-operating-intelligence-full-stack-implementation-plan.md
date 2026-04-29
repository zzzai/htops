# Operating Intelligence Full-Stack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前 `画像/分层/召回 + 外部知识解释链 + 日报/周报 + 夜间学习闭环` 提升为统一的经营智能系统初版骨架。

**Architecture:** 保持当前 `事实层 -> owner modules -> serving/read surfaces -> safe execution` 演进路径，不重开第二套运行时。先补“统一分类、统一上下文、统一决策出口”，再逐步补竞对、行业、宏观、资本等外部信号，始终坚持硬事实、软事实、弱信号三层边界。

**Tech Stack:** TypeScript, Vitest, PostgreSQL owner store, current customer-growth / reporting / query modules, checked-in JSON/Markdown assets, bounded AI assemblers

## 2026-04-21 进度回写

- `Task 1`：completed
- `Task 2`：partial，当前已具备 `truthLevel + applicableModules + notForScoring`，但统一 usage / visibility taxonomy 还未完全收口
- `Task 3`：partial，天气、节气、基础外部知识已入 explanation 和部分策略；store event / competitor pressure hints 仍待补
- `Task 4`：not started，行业态势 owner module / snapshot store 尚未落地
- `Task 5`：partial，周报已有 world model supplement 入口，但统一 industry-context read chain 还未建立
- `Task 6`：completed，顾客经营画像 + bounded action bridge 已正式入链
- `Task 7`：partial，nightly review / semantic quality 已吸收 customer profile signals，但更完整的 doctor taxonomy 与经营智能复盘面仍待扩
- `Task 8`：completed
- P0 收口补充：Hermes 前门已补高频经营问法路由兜底，`昨天客流量多少 / 昨天到店人数 / 今日点钟率多少` 这类单店高频问法不再默认落回普通闲聊
- P0 收口补充：真实企微经理权限已补回归覆盖，当前已显式校验 郭正朝 / 侯朝君 / 李人培 / 刘亮 的 senderName -> 门店 scope 自动绑定
- P0 收口补充：日报缓存若缺 `预估到店人数` 行，会在发送前自动重建，避免“算出来但没展示”的旧缓存继续外发
- P0 收口补充：doctor / admin read 已新增“当前营业日日报 readiness”摘要，可直接看出 ready / refresh-needed / incomplete / missing 的门店分布

这意味着当前 full-stack 计划最扎实的落点仍在两条线上：

- customer operating profile 主链
- 夜间学习闭环对 customer profile gaps 的最小吸收

而行业态势层、总部统一上下文装配、跨店聚合决策面，仍是后续波次。

---

### Task 1: 固化经营智能系统的统一术语与边界

**Files:**
- Create: `docs/plans/2026-04-21-operating-intelligence-full-stack-design.md`
- Modify: `docs/plans/2026-04-19-customer-growth-production-grade-design.md`
- Modify: `docs/plans/2026-04-19-store-external-context-and-ai-assembler-design.md`

**Step 1: 回看现有 customer growth 与 external context 设计**

- 抽取当前已存在的 owner path、truth level、AI boundary
- 明确哪些内容需要提升为统一经营智能术语

**Step 2: 写出统一术语与分层**

- 明确：
  - 经营事实层
  - 门店环境层
  - 行业态势层
  - 决策与执行层
  - 夜间学习进化层
- 明确：
  - 硬事实
  - 软事实
  - 弱信号

**Step 3: 保存设计文档并回写已有设计的引用关系**

- 避免后续继续把画像、外部知识、周报、夜间学习各写各的

**Step 4: 人工校读**

Run: `rg -n "经营事实层|门店环境层|行业态势层|弱信号|硬事实|软事实" docs/plans`

Expected:

- 新设计与旧设计之间的术语关系可被清晰检索

### Task 2: 在类型层补统一上下文分类能力

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store-external-context.ts`
- Test: `src/store-external-context.test.ts`

**Step 1: Write the failing test**

- 为 store external context 增加“应用层级 / 决策层级”测试
- 验证：
  - `confirmed` 可进入事实使用层
  - `estimated` 可进入 bounded strategy / explanation
  - `research_note` 默认只进入 explanation / HQ narrative

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/store-external-context.test.ts`

Expected:

- FAIL，因为当前只有 truth level，还没有更明确的应用边界元数据

**Step 3: Write minimal implementation**

- 在类型层补：
  - context usage category
  - decision visibility category
  - scoring eligibility marker
- assembler 输出中显式保留这些边界

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/store-external-context.test.ts`

Expected:

- PASS，并且 AI payload 中的边界更明确

### Task 3: 扩展门店环境层，从“外部知识”升级为“经营环境上下文”

**Files:**
- Modify: `src/customer-growth/environment-context.ts`
- Modify: `src/store-external-context.ts`
- Modify: `src/store-query.ts`
- Test: `src/environment-context.test.ts`
- Test: `src/store-query.test.ts`

**Step 1: Write the failing tests**

- 增加测试，验证环境上下文可以同时承载：
  - 节气/天气
  - 门店事件
  - 商圈与停车等环境事实
  - bounded 竞对摘要

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/environment-context.test.ts src/store-query.test.ts`

Expected:

- FAIL，因为当前环境层还偏向时令与基础门店外部知识

**Step 3: Write minimal implementation**

- 不改变 `environment-context` 的 bounded 原则
- 新增：
  - store event hints
  - market context hints
  - competitor pressure hints
- 先作为 explanation / priority nudging 输入，不直接改硬评分

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/environment-context.test.ts src/store-query.test.ts`

Expected:

- PASS，并且说明环境层已从“天气节气”升级为“经营环境上下文”

### Task 4: 新增行业态势层的最小存储与装配能力

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Add: `src/industry-context.ts`
- Add: `src/industry-context.test.ts`
- Add: `src/store-industry-context.test.ts`

**Step 1: Write the failing tests**

- 为行业态势新增最小 snapshot 存储测试
- 验证可以按日期读取：
  - 行业景气标签
  - 平台规则变化
  - 城市消费趋势
  - 资本/赛道热度备注

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/industry-context.test.ts src/store-industry-context.test.ts`

Expected:

- FAIL，因为当前仓库还没有行业态势 owner module

**Step 3: Write minimal implementation**

- 在 store owner 层新增一张最小快照表
- 新增 assembler，把弱信号整理成：
  - HQ 可读 narrative
  - 门店诊断辅助说明
- 默认不进入单客召回主评分

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/industry-context.test.ts src/store-industry-context.test.ts`

Expected:

- PASS，形成最小行业态势层

### Task 5: 打通“统一经营上下文 -> 日报/周报/总部诊断”读链路

**Files:**
- Modify: `src/app/reporting-service.ts`
- Modify: `src/weekly-report.ts`
- Modify: `src/query-engine-renderer.ts`
- Test: `src/app/reporting-service-weekly-report.test.ts`
- Test: `src/weekly-report.test.ts`
- Test: `src/query-engine-renderer.test.ts`

**Step 1: Write the failing tests**

- 增加测试，验证：
  - 周报可读取行业态势层摘要
  - 总部诊断可引用门店环境层与行业层
  - 店长日报仍保持以硬事实为主，不被弱信号污染

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/reporting-service-weekly-report.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts`

Expected:

- FAIL，因为当前读链路还没有统一接入行业态势层

**Step 3: Write minimal implementation**

- 为周报和 HQ narrative 增加统一上下文装配
- 保持店长日报谨慎，只增加低风险经营提示
- 总部周报可额外吸收：
  - 竞对变化
  - 行业变化
  - 平台/宏观弱信号

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/reporting-service-weekly-report.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts`

Expected:

- PASS，并形成“门店读链”和“总部读链”的区分

### Task 6: 把画像/分层/召回从单点增长能力升级成基于顾客经营画像的经营动作引擎

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Add: `src/customer-growth/customer-observation.ts`
- Add: `src/customer-growth/customer-operating-profile.ts`
- Add: `src/customer-growth/action-profile-bridge.ts`
- Modify: `src/customer-growth/reactivation/strategy.ts`
- Modify: `src/customer-growth/reactivation/queue.ts`
- Modify: `src/customer-growth/reactivation/learning.ts`
- Modify: `src/customer-growth/intelligence.ts`
- Modify: `src/customer-growth/profile.ts`
- Modify: `src/world-model/types.ts`
- Test: `src/customer-growth/customer-observation.test.ts`
- Test: `src/customer-growth/customer-operating-profile.test.ts`
- Test: `src/customer-growth/action-profile-bridge.test.ts`
- Test: `src/reactivation-strategy.test.ts`
- Test: `src/reactivation-queue.test.ts`
- Test: `src/customer-intelligence.test.ts`

**Step 1: Write the failing tests**

- 增加测试，验证策略层可以吸收：
  - 顾客服务过程 observation
  - 顾客经营画像快照
  - 服务诉求匹配
  - 时段场景匹配
  - 技师关系强度
  - 跟进渠道适配
  - 环境层 bounded hints
  - 门店容量与供给约束
  - 反馈学习快照
- 保证弱信号不会直接改 customer segment

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/customer-growth/customer-observation.test.ts src/customer-growth/customer-operating-profile.test.ts src/customer-growth/action-profile-bridge.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-intelligence.test.ts`

Expected:

- FAIL，因为当前更像“增长策略器”，还不是“基于顾客经营画像的经营动作引擎”

**Step 3: Write minimal implementation**

- 新增顾客服务 observation 存储和归一化 owner path
- 新增顾客经营画像快照，显式区分：
  - `hard_fact`
  - `observed_fact`
  - `inferred_label`
  - `predicted_signal`
- 新增 action-profile bridge，把顾客经营画像转成 bounded action inputs：
  - `time_slot_fit_adjustment`
  - `service_need_match_adjustment`
  - `relationship_strength_adjustment`
  - `channel_fit_adjustment`
  - `confidence_discount`
- 把门店环境、供给容量、学习反馈统一变成 bounded adjustment inputs
- 保持 customer segment 由 deterministic 核心主导
- 让 recommended action 与 queue priority 更像经营动作建议而不只是召回排序

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/customer-growth/customer-observation.test.ts src/customer-growth/customer-operating-profile.test.ts src/customer-growth/action-profile-bridge.test.ts src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-intelligence.test.ts`

Expected:

- PASS，并形成“分层不乱、动作更准、画像正式入链”的状态

补充设计参考：

- `docs/plans/2026-04-21-customer-operating-profile-design.md`
- `docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md`

### Task 7: 把夜间学习闭环升级成经营智能进化引擎

**Files:**
- Modify: `src/app/semantic-quality-service.ts`
- Modify: `src/app/conversation-review-service.ts`
- Modify: `src/customer-growth/reactivation/learning.ts`
- Modify: `src/ops/doctor.ts`
- Test: `src/app/semantic-quality-service.test.ts`
- Test: `src/app/conversation-review-service.test.ts`
- Test: `src/ops/doctor.test.ts`

**Step 1: Write the failing tests**

- 增加测试，验证夜间闭环不仅能聚合问答失败，还能聚合：
  - 召回动作效果差
  - 外部上下文缺口
  - 行业态势缺口
  - 解释质量缺口

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/semantic-quality-service.test.ts src/app/conversation-review-service.test.ts src/ops/doctor.test.ts`

Expected:

- FAIL，因为当前夜间学习闭环主要聚焦语义问答和 review finding

**Step 3: Write minimal implementation**

- 把经营动作失败与上下文缺口收编进 quality summary
- doctor 增加：
  - data gap
  - context gap
  - decision gap
  - execution gap

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/semantic-quality-service.test.ts src/app/conversation-review-service.test.ts src/ops/doctor.test.ts`

Expected:

- PASS，夜间闭环从“语义系统复盘”升级为“经营智能系统复盘”

### Task 8: 文档回写与收口

**Files:**
- Modify: `docs/plans/2026-04-21-operating-intelligence-full-stack-design.md`
- Modify: `docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md`
- Modify: `docs/plans/2026-04-19-customer-growth-production-grade-implementation-plan.md`

**Step 1: 回写每一波交付状态**

- 标注哪些能力已经是 MVP
- 哪些进入 production-grade
- 哪些仍是 HQ narrative-only

**Step 2: 跑聚合验证**

Run:

- `pnpm exec vitest run src/store-external-context.test.ts src/environment-context.test.ts src/store-query.test.ts`
- `pnpm exec vitest run src/app/reporting-service-weekly-report.test.ts src/weekly-report.test.ts src/query-engine-renderer.test.ts`
- `pnpm exec vitest run src/reactivation-strategy.test.ts src/reactivation-queue.test.ts src/customer-intelligence.test.ts`
- `pnpm exec vitest run src/app/semantic-quality-service.test.ts src/app/conversation-review-service.test.ts src/ops/doctor.test.ts`

Expected:

- 所有新增主链相关测试通过

**Step 3: 汇报阶段结果**

- 说明哪些能力已经进入：
  - 店长动作面
  - 总部诊断面
  - 夜间学习面
- 说明哪些能力仍然是后续波次：
  - 更细行业态势
  - 更强竞对 intelligence
  - 更强宏观和资本层信号

Plan complete and saved to `docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
