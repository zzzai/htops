# Ontos-lite Module Mapping For htops

日期：2026-04-17  
状态：current-state map  
用途：把 `Ontos-lite` 在 `htops` 中对应到现有模块、当前完成度和下一步最小落点，避免后续讨论停留在抽象术语层。

## 结论先行

`htops` 当前并不是“还没开始吸收 Ontos”，而是已经有了明显骨架：

- L1-L3 已经基本成型
- L4-L6 已有局部能力，但还没有完全显式化
- 项目当前认可的是 **Ontos-lite**
  - 不新建第二套 ontology runtime
  - 不用 Ontos 替代 `capability graph`
  - 只把 Ontos 吸收为：
    - `capability graph`
    - `conversation semantic state`
    - `semantic execution audit / semantic quality loop`

一句话判断：

**当前项目最强的是“业务语义目录 + 安全执行 + 控制平面”，最弱的是“多轮语义状态 + 统一语义质量闭环”。**

## 映射总表

| Ontos-lite 层 | 目标含义 | 当前最接近的模块 | 当前状态 | 判断 |
| --- | --- | --- | --- | --- |
| L1 业务语义层 | 实体、指标、概念、能力目录 | `src/capability-graph.ts`, `src/query-intent.ts`, `src/query-plan.ts`, `src/store-query.ts`, `src/customer-query.ts`, `src/customer-profile.ts`, `src/tech-profile.ts` | 已落地较多 | 强 |
| L2 关系语义层 | 门店/时间/指标/比较关系、能力依赖关系 | `src/capability-graph.ts`, `src/query-semantics.ts`, `src/query-route-registry.ts`, `src/tools/contracts.ts` | 有骨架，但不少关系仍隐式存在代码里 | 中等 |
| L3 流程语义层 | 查询、同步、日报、投递、补数等业务动作顺序 | `src/sync-orchestrator.ts`, `src/schedule.ts`, `src/app/sync-service.ts`, `src/app/reporting-service.ts`, `src/delivery-orchestrator.ts`, `src/app/admin-read-service.ts` | 主生产链已成型 | 强 |
| L4 上下文语义层 | 当前会话上下文、clarify 延续、语义锚点 | `src/app/message-entry-service.ts`, `src/semantic-intent.ts`, `src/inbound.ts`, `src/app/intent-clarifier-service.ts` | 有入口和澄清能力，但缺显式持久状态层 | 偏弱 |
| L5 记忆/延续层 | 多轮目标延续、已确认条件、待补充条件 | `src/ai-semantic-fallback.ts`, `src/app/intent-clarifier-service.ts`, 设计中的 `conversation semantic state` | 设计已批准，工程层尚未完整落地 | 弱 |
| L6 质量闭环层 | 失败分类、clarify rate、fallback rate、成功率、回放能力 | `src/ops/doctor.ts`, `src/route-compare-summary.ts`, `src/app/admin-read-service.ts`, `api/main.py`, 命令/入站审计 | 控制面较强，但缺统一 `semantic_execution_audits` 真相源 | 中等偏弱 |

## 分层展开

### L1：业务语义层

对应模块：

- `src/capability-graph.ts`
- `src/query-intent.ts`
- `src/query-plan.ts`
- `src/store-query.ts`
- `src/customer-query.ts`
- `src/customer-profile.ts`
- `src/tech-profile.ts`
- `src/metric-query.ts`

当前完成度：

- 已经是当前项目最成熟的 Ontos-lite 承载层
- 查询主链已经稳定围绕：
  - 语义识别
  - capability 选择
  - plan 生成
  - safe execution
- 很多原本漂在 executor/tools 里的业务语义，已经被收回 owner modules

已完成的事：

- `capability graph` 已成为查询能力目录核心
- `query-engine-executor` 已大量退回 owner-module delegation
- tools/function calling 已被约束为结构化入口，而不是自由执行器

还缺什么：

- capability 的关系语义还不够“可见”
- 一些 required/optional slot、失败策略、质量策略仍偏代码内隐

判断：

**这是当前项目的最强层。**

### L2：关系语义层

对应模块：

- `src/capability-graph.ts`
- `src/query-semantics.ts`
- `src/query-route-registry.ts`
- `src/tools/contracts.ts`
- `src/query-engine.ts`

当前完成度：

- 已有关系表达，但仍不够显式
- 很多“门店 + 时间 + 指标 + 比较对象”的组合关系是通过代码规则推出来的
- 还没有完全变成统一的、可枚举的关系层

已完成的事：

- capability 与 query route 的映射已存在
- tools contract 已开始显式声明：
  - `entry_role`
  - `owner_surface`
  - `semantic_capability_ids`
  - `execution_boundary`

还缺什么：

- 关系层还没有一个统一的可审视视图
- 缺稳定的“语义 slot 关系字典”或关系级质量统计

判断：

**骨架有了，但还没完全显式化。**

### L3：流程语义层

对应模块：

- `src/sync-orchestrator.ts`
- `src/schedule.ts`
- `src/app/sync-service.ts`
- `src/app/reporting-service.ts`
- `src/delivery-orchestrator.ts`
- `src/app/delivery-service.ts`
- `src/app/admin-read-service.ts`
- `src/runtime.ts`
- `api/main.py`

当前完成度：

- 这是除了 L1 之外，当前最成熟的一层
- scheduler / queue / doctor / report delivery upgrade telemetry 已经形成了明确控制面

已完成的事：

- scheduled execution 已拆成 `sync lane / delivery lane`
- doctor 已能解释：
  - authoritative pollers
  - queue 状态
  - scheduler job 语义
  - report delivery upgrades
- Query API 与 Node 控制面已尽量对齐

还缺什么：

- 还有少量停机/重启体验问题，比如 scheduled worker 的 graceful shutdown
- 一些非主线流程如 external brief、midday brief、reactivation push 仍未完全启用

判断：

**主链已成型，可支撑生产。**

### L4：上下文语义层

对应模块：

- `src/app/message-entry-service.ts`
- `src/semantic-intent.ts`
- `src/inbound.ts`
- `src/app/intent-clarifier-service.ts`
- `src/app/reply-guard-service.ts`

当前完成度：

- 已经具备 clarify、入口协调、基础语义分流
- 但“当前会话正在问什么、缺什么、上一轮确认了什么”仍没有稳定的持久化 owner

已完成的事：

- message entry 已经成为语义入口 owner
- clarify 已能在单轮中工作
- semantic fallback 已有受控入口点

还缺什么：

- 缺 `conversation semantic state`
- 缺 `conversation anchor facts`
- 缺多轮澄清的稳定延续

建议落点：

- `src/app/conversation-semantic-state-service.ts`
- `src/store/conversation-semantic-state-store.ts`

判断：

**这是 Ontos-lite 当前最值得补的一层。**

### L5：记忆/延续层

对应模块：

- `src/ai-semantic-fallback.ts`
- `src/app/intent-clarifier-service.ts`
- 设计文档：
  - `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md`

当前完成度：

- 现在更多是“有一些延续意图”，但没有形成正式记忆层
- 仍然偏单轮语义和保守 clarify

已完成的事：

- 已经明确批准不做完整 BDI 平台
- 已经明确批准只做最小会话语义状态

还缺什么：

- 当前目标
- 已确认 slots
- 待补充 slots
- topic switch reset
- clarify pending TTL

建议落点：

- 只做 Postgres-backed minimal semantic state
- 不引入新平台，不做独立 memory ontology runtime

判断：

**这是设计已明确、代码尚未完整落地的一层。**

### L6：质量闭环层

对应模块：

- `src/ops/doctor.ts`
- `src/route-compare-summary.ts`
- `src/app/admin-read-service.ts`
- `api/main.py`
- `src/command.ts`
- `src/inbound-audit-reader.ts`
- `src/app/message-entry-service.ts`

当前完成度：

- 运营控制面已经不弱
- 但语义质量面仍不是单一真相源

已完成的事：

- doctor 已能看：
  - scheduler
  - queue
  - report delivery upgrades
  - 部分 route / command telemetry
- route compare 与 frontdoor summary 已有脚本
- 命令审计、入站审计已存在

还缺什么：

- 统一的 `semantic_execution_audits`
- 统一 failure taxonomy
- clarify / fallback / success rate 的统一聚合

建议落点：

- `src/app/semantic-quality-service.ts`
- `src/store/semantic-execution-audit-store.ts`

判断：

**这是第二个最值得补的 Ontos-lite 层。**

## 当前模块完成度视图

### 已经可视为 Ontos-lite 骨架完成的模块

- `src/capability-graph.ts`
- `src/query-intent.ts`
- `src/query-plan.ts`
- `src/sql-compiler.ts`
- `src/query-engine.ts`
- `src/store-query.ts`
- `src/customer-query.ts`
- `src/customer-profile.ts`
- `src/tech-profile.ts`
- `src/sync-orchestrator.ts`
- `src/app/sync-service.ts`
- `src/app/reporting-service.ts`
- `src/app/admin-read-service.ts`
- `src/ops/doctor.ts`

### 已有骨架但还不够完整的模块

- `src/app/message-entry-service.ts`
- `src/semantic-intent.ts`
- `src/ai-semantic-fallback.ts`
- `src/route-compare-summary.ts`
- `api/main.py`

### 已经批准但尚未落地为正式 owner 的模块

- `src/app/conversation-semantic-state-service.ts`
- `src/store/conversation-semantic-state-store.ts`
- `src/app/semantic-quality-service.ts`
- `src/store/semantic-execution-audit-store.ts`

## 最小落地顺序

如果按投入产出排序，Ontos-lite 在当前项目里的最小落地顺序应是：

1. 先补 `conversation semantic state`
   - 解决多轮 clarify、状态延续、topic switch
2. 再补 `semantic execution audit`
   - 解决失败分类、clarify rate、fallback rate 不可统一统计
3. 再补 doctor / admin summary
   - 把质量面真正接入控制面
4. 最后再评估 AI 是否值得更前置

## 最终判断

对当前 `htops` 来说：

- Ontos-lite 不是一套新平台
- 它是一张“当前缺什么、该补哪一层、该放到哪个 owner module”的工程地图

这张地图已经很清楚：

- **L1-L3：强**
- **L4-L5：待补**
- **L6：已有基础，但缺统一真相源**

因此，项目下一阶段如果继续沿 Ontos-lite 推进，最合理的主线不是重构平台，而是：

**`message-entry-service` + `conversation semantic state` + `semantic execution audit` + `doctor quality summary`**
