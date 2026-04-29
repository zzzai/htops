# ADR: Control Plane, Query Observability, and Tool Entry Boundaries

日期：2026-04-16
状态：accepted

---

## 背景

htops 当前已经形成较明确的目标架构：

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

但在进入生产收口阶段后，出现了 4 类容易反复漂移的问题：

1. control plane 语义与实际执行链路不完全一致
2. query observability 存在日志但缺少值班可直接阅读的摘要
3. function calling 的引入边界容易被说成“让 AI 自己查”
4. Redis 容易被当作通用优化手段提前引入

---

## 决策

### 1. Control plane contract 必须是单一真相源

控制面共享静态定义统一收在：

- `src/control-plane-contract.json`

该 contract 至少负责：

- scheduler jobs
- service pollers
- contract version
- scheduler job surface semantics

### 2. 条件性任务不隐藏，但必须显式标注

`run-customer-history-catchup` 保留在 control surface 中，但标注为：

- `surface_role = conditional`
- `surface_note = 仅在夜间原始事实完成后继续补顾客派生层；pending 不代表主链异常`

理由：

- 隐藏它会降低值班可见性
- 但不标注会被误读成主链故障

### 3. Query observability 先基于现有日志面增强，不先引入新状态表

第一阶段 query observability 使用：

- `hetang-ops: route-compare ...`
- `scripts/summarize-route-compare.ts`
- `scripts/summarize-hermes-frontdoor.ts`

摘要必须能直接回答：

- 当前 lane 分布如何
- capability 命中如何
- clarification 占比如何
- P50 / P95 latency 如何
- 最慢样本有哪些

### 4. Function calling 只能作为标准入口，不得绕过 deterministic spine

允许的 function calling 角色：

- 把自然语言问题翻译为结构化任务单
- 任务单再映射到 capability graph / safe execution / bounded command surface

禁止的 function calling 角色：

- 自由拼 SQL
- 绕过 capability graph 直接访问底层表
- 让 AI 自己决定“想查什么就查什么”

结论：

- function calling 可以引入
- 但只能作为 `entry adapter`
- 不能替代查询主链

### 5. Bridge capabilities 要暴露控制面版本锚点

Bridge capability 描述除了 query graph version，还应暴露：

- `control_plane_contract_version`

理由：

- bridge / inbound / query 在调试和灰度期间需要共享同一锚点
- 这是一种低成本的跨入口一致性检查

### 6. Redis 暂不引入

Redis 只有在以下条件满足时才进入候选：

1. 多实例 bridge/query 部署成为常态
2. PostgreSQL serving 读取出现明确热点与成本证据
3. 本地 TTL cache 与 PostgreSQL advisory lock 已不能解决重复查询或协调问题

在此之前：

- PostgreSQL 仍是事实与协调真相源
- 轻量缓存优先保留在进程内、贴近 serving query 执行边界

---

## 结果

### 正面影响

- control plane 不再含糊解释
- 值班成本下降
- function calling / Redis 的讨论有了明确边界
- 新入口能力不容易绕开 deterministic spine

### 负面影响

- conditional job 仍会显示在 surface 上，界面信息量略增
- query observability 仍以日志摘要为主，不是完整数据库化指标系统

---

## 后续触发条件

以下情况出现时，应写 follow-up ADR，而不是临时聊天决策：

1. 计划把 function calling 接入到真实生产入口
2. 准备引入 Redis
3. bridge / inbound / query 将改为多实例部署
4. route-compare 日志摘要已经不足以支撑 query 观测
