# Hermes Conversation Review Control Plane Design

日期：2026-04-16  
状态：approved  
用途：把 Hermes 的“自学习 / 自记忆 / 自进化”能力收口为 `htops` 的离线复盘控制平面，而不是让模型直接接管业务查询与执行。

---

## 1. 问题

当前 `htops` 已经具备三块重要基础：

1. 真实入站审计：`inbound_message_audit_logs`
2. shadow / route compare 观测：semantic 路由与 legacy 路由可比较
3. bounded analysis：analysis 已经从单次 prompt 推进到 `evidence_pack -> diagnostic_signals -> bounded_synthesis`

但系统还缺少一个正式的“复盘闭环”：

1. 用户纠正、答错、clarify 缺失、权限漂移，仍主要停留在人工观察和临时修补
2. Hermes 的 memory 能记住偏好，但不能替代结构化控制面，也不能成为业务真相源
3. shadow telemetry 和 analysis fallback 能观测问题，但没有 nightly review job 把问题沉淀为结构化 findings 和后续动作

结果是：

- 我们知道系统哪里会错，但不能持续、系统地收口
- 纠偏依赖当场对话，不依赖正式 review run
- “自学习”目前还不是 `htops` 的一个可审计能力

---

## 2. 目标

本设计的目标是新增一条受控控制面：

`真实对话 / shadow telemetry / analysis fallback / 用户纠正`
`-> conversation review run`
`-> structured findings`
`-> suggested action items`
`-> 人工确认`
`-> 更新样本 / 规则 / capability graph / 结构化配置`

第一期必须解决的问题：

1. 能每天离线复盘最近一天的真实对话
2. 能把问题归类成结构化 findings，而不是只输出一段大模型总结
3. 能给出建议动作，但不直接修改线上权限、查询逻辑或业务配置
4. 能和现有 `action_center_items`、shadow telemetry、analysis orchestration 元数据对齐

---

## 3. 非目标

本次不做：

1. 不让 Hermes 直接凭 memory 回答门店经营数据
2. 不让模型直接修改权限、chat_id、组织绑定、SQL 或执行计划
3. 不做无界 agent loop
4. 不把新的业务入口职责塞进 `src/runtime.ts`
5. 不把“conversation review”做成新的线上慢路径阻塞首答

---

## 4. 核心原则

### 4.1 数据平面与控制平面分离

- `htops` 数据平面继续负责：查询、权限、绑定、口径、安全执行
- `Hermes` 控制平面负责：复盘、归因、建议、经验沉淀

### 4.2 Memory 只记稳定约定，不记业务真相

适合进入 Hermes memory 的内容：

- 用户长期偏好
- 常见默认时间窗约定
- 群聊沟通习惯
- 稳定表达口径

不适合进入 memory 的内容：

- 门店日报与经营事实
- 顾客画像结果
- 员工权限
- chat_id 唯一真相
- 门店绑定与 scope 权限

后者必须落结构化 owner store。

### 4.3 学习必须离线、可审计、可回滚

所有“自学习”输出必须先变成结构化 finding 或 suggested action item，随后人工确认，最后才能进入：

- utterance sample library
- semantic intent rules
- capability graph
- control tower setting
- employee binding / scope config

---

## 5. 推荐架构

### 5.1 总体链路

推荐采用固定五段式控制面：

1. `source_collection`
2. `deterministic_preclassification`
3. `bounded_review_synthesis`
4. `finding_normalization`
5. `review_summary_and_actions`

其中：

- 前两段必须 deterministic-first
- 第三段允许模型参与，但只能做有界归因与优先级排序
- 第四段负责把结果落成结构化 finding
- 第五段负责输出 nightly summary 和 suggested action items

### 5.2 输入源

第一期输入源建议分三层：

#### A. 权威输入

- `inbound_message_audit_logs`
- `analysis_jobs.result_text` 中的 orchestration metadata
- `action_center_items` 中与分析和 learning 相关的已有动作

#### B. 半权威输入

- shadow / route compare 样本
- metaQueryProbeOutcome
- semantic / legacy lane diff

这些信息若当前只在日志里，第一期通过 review source adapter 接入，允许缺失，但接口必须先定好。

#### C. 推断输入

- 用户纠正语句检测
- 连续两轮对话中的“不是这个店 / 不是这个时间 / 默认 5 天”模式

这些仅作为 finding 证据，不可写回权限真相。

---

## 6. 数据模型

第一期新增两张表。

### 6.1 `conversation_review_runs`

用途：记录每一次 nightly review 的批次级元数据。

建议字段：

- `review_run_id` TEXT PRIMARY KEY
- `review_date` TEXT
- `source_window_start` TEXT
- `source_window_end` TEXT
- `status` TEXT
- `input_conversation_count` INTEGER
- `input_shadow_sample_count` INTEGER
- `input_analysis_job_count` INTEGER
- `finding_count` INTEGER
- `summary_json` TEXT
- `started_at` TEXT
- `completed_at` TEXT
- `created_at` TEXT
- `updated_at` TEXT

### 6.2 `conversation_review_findings`

用途：记录批次内每一个可执行、可审计的问题发现。

建议字段：

- `finding_id` TEXT PRIMARY KEY
- `review_run_id` TEXT NOT NULL
- `conversation_id` TEXT
- `message_id` TEXT
- `job_id` TEXT
- `channel` TEXT
- `account_id` TEXT
- `chat_id` TEXT
- `sender_id` TEXT
- `org_id` TEXT
- `store_name` TEXT
- `finding_type` TEXT
- `severity` TEXT
- `confidence` DOUBLE PRECISION
- `title` TEXT
- `summary` TEXT
- `evidence_json` TEXT
- `suggested_action_type` TEXT
- `suggested_action_payload_json` TEXT
- `memory_candidate_json` TEXT
- `status` TEXT
- `created_at` TEXT
- `resolved_at` TEXT

### 6.3 finding 类型

第一期 taxonomy 固定为：

- `intent_gap`
- `scope_gap`
- `permission_drift`
- `capability_gap`
- `reply_quality_issue`
- `analysis_gap`
- `memory_candidate`

不建议第一期再细化更多一级类，避免 taxonomy 先失控。

---

## 7. Suggested Action 类型

第一期 suggested action 只建议，不直接执行。

建议动作类型：

- `add_eval_sample`
- `add_utterance_pattern`
- `tighten_guardrail`
- `fix_binding_or_permission`
- `extend_capability_graph`
- `add_diagnostic_signal`
- `update_renderer_or_prompt`
- `promote_to_structured_config`
- `write_memory_fact`

其中：

- `fix_binding_or_permission` 只能进入待确认，不得自动落库
- `write_memory_fact` 也只能进入待确认，不得自动写入 Hermes memory

---

## 8. 模块边界

### 8.1 Store / Schema

新增表和 store 方法应落在：

- `src/store.ts`
- `src/store/queue-access-control-store.ts`
- `src/types.ts`

原因：

- 这两张表属于控制平面元数据，不属于 serving、raw ingestion 或 mart derived
- 与 `employee_bindings`、`command_audit_logs`、`inbound_message_audit_logs`、`analysis_jobs` 同属 queue / access control surface

### 8.2 Review 运行层

建议新增：

- `src/app/conversation-review-service.ts`
- `src/app/conversation-review-finding-service.ts`

职责分别为：

- `conversation-review-service.ts`
  - source collection
  - review run lifecycle
  - nightly summary build

- `conversation-review-finding-service.ts`
  - deterministic preclassification
  - bounded review synthesis input shaping
  - finding normalization

### 8.3 调度与控制面

建议修改：

- `src/control-plane-contract.json`
- `src/types.ts`
- `src/schedule.ts`
- `src/app/sync-service.ts`

新增一个 scheduler job：

- `nightly-conversation-review`

推荐挂在 `sync` orchestrator 下，而不是 `delivery` 或 `analysis`：

- 它是 nightly control-plane maintenance
- 它不应抢占 analysis worker
- 它应与日报、补数、外部情报一样由 scheduled worker 驱动

### 8.4 读取与运维面

建议补到：

- `src/app/admin-read-service.ts`

至少提供：

- latest review run summary
- top findings by severity
- latest unresolved permission drift / capability gap / analysis gap

---

## 9. Review Pipeline 细节

### Stage 1: `source_collection`

输入：

- 指定时间窗内的 inbound audits
- 同时间窗 analysis jobs
- 同时间窗 shadow / route compare samples

输出：

- review source bundle

### Stage 2: `deterministic_preclassification`

必须先做规则判断，不允许直接把原始文本扔给模型。

第一期 deterministic 信号：

- 是否出现用户显式纠正
- 是否出现 route mismatch
- 是否缺 clarify 但直接回答
- 是否 analysis orchestration fallback
- 是否 identity / scope unstable
- 是否命中 fast-lane / business-lane 明显错分

输出：

- `preclassifiedFindingCandidates`

### Stage 3: `bounded_review_synthesis`

模型只能做：

- 给 finding 候选排序
- 解释根因
- 推荐下一步动作

模型不能做：

- 发明新的业务事实
- 直接修改 binding / permission
- 修改 capability graph
- 写入 memory

输出必须是严格 JSON。

### Stage 4: `finding_normalization`

把模型输出和 deterministic signals 合并成结构化 findings。

规则：

- deterministic 证据优先
- 模型补充解释，不覆盖原证据
- suggested action 归一化为固定 action type

### Stage 5: `review_summary_and_actions`

输出：

- nightly review summary
- top mismatch classes
- suggested action items
- optional memory candidates

第一期 summary 不直接推送到企微，只先进入 admin read surface 或 CLI 查询。

---

## 10. 失败策略

review job 必须 stage-bounded degrade：

- source collection 失败：
  - run 标记 failed
- deterministic preclassification 失败：
  - run 标记 failed
- bounded review synthesis 失败：
  - 退化为 deterministic-only findings
- summary build 失败：
  - findings 保留，summary_json 置空

关键原则：

**review 可以降级，但不能 silent fail，也不能阻塞主业务链。**

---

## 11. 上线策略

### 第一阶段：只落库，不自动创建 action

先只做：

- review runs
- review findings
- admin read summary

### 第二阶段：把 suggested action 映射为 `action_center_items`

仅对低风险动作开放：

- `add_eval_sample`
- `add_utterance_pattern`
- `add_diagnostic_signal`
- `promote_to_structured_config`

且状态只能是 `proposed`。

### 第三阶段：memory candidate 治理

只允许人工确认后把 memory candidate 写入 Hermes memory。

---

## 12. 验收标准

第一期上线后一周内，系统必须能回答：

1. 最近 24 小时最常见的错路由是什么
2. 最近 24 小时最常见的 scope 缺口是什么
3. 哪些问题最该补 utterance sample
4. 哪些 analysis 问题最该补 diagnostic signal
5. 哪些权限问题最可能是 binding 漂移，而不是用户本身无权限

如果这些问题仍然需要人工翻日志，说明控制面没有真正建成。

---

## 13. 推荐实施顺序

1. 先建表和 store contract
2. 再做 deterministic finding classifier
3. 再做 review run service
4. 再接 scheduler job
5. 最后补 admin read summary 与 suggested action output

一句话结论：

`Hermes 为 htops 提供的最佳能力，不是“替代查询”，而是“持续复盘、发现缺口、沉淀动作”的控制平面。`
