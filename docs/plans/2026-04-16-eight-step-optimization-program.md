# Eight-Step Optimization Program

日期：2026-04-16
状态：in-progress
用途：把本轮“项目真正优化完成前还差的 8 步”落为可追踪状态，区分已完成、部分完成和后续项。

---

## 1. 收掉 scheduler 最后一个语义歧义

状态：done

已落地：

- `src/control-plane-contract.json`
  - 新增 `version`
  - 新增 scheduler job `surface_role`
  - 新增 scheduler job `surface_note`
- `src/schedule.ts`
  - scheduler catalog 读取 surface semantics
- `src/app/admin-read-service.ts`
  - scheduler status 暴露 `contractVersion`
- `src/ops/doctor.ts`
  - conditional job 明确渲染 `role` / `note`
- `api/main.py`
  - `/runtime/scheduler` 暴露 `contract_version`

结果：

- `run-customer-history-catchup` 不再只是一个模糊的 `pending`
- control plane 开始明确表达“条件性任务不等于主链故障”

## 2. 把 query / serving 观测补成可决策级别

状态：done

已落地：

- `src/route-compare-summary.ts`
  - 新增 `clarificationNeededCount`
  - 新增 `selectedLanes`
  - 新增 `selectedCapabilities`
  - 新增 `slowSamples`
- `scripts/summarize-route-compare.ts`
  - 直接继承增强后的摘要能力

结果：

- 现有日志面已经能直接回答 lane / capability / latency / clarification 四类问题
- 不需要先引入新状态表才能做运营判断

## 3. 做一轮完整的生产验收回放

状态：done

已落地：

- `docs/plans/2026-04-16-control-plane-production-acceptance-checklist.md`

结果：

- worker / doctor / Query API / report send status / route telemetry 有了统一验收顺序

## 4. 把控制面决策沉淀成 durable 文档

状态：done

已落地：

- `docs/adr/2026-04-16-control-plane-query-observability-and-tool-entry.md`

结果：

- control plane、query observability、function calling、Redis 时机都有了稳定决策锚点

## 5. 继续收 query plane owner boundary

状态：done

已落地：

- `docs/prompts/project-architecture-rules.md`
  - 强化 capability graph / safe execution 约束

本轮收口标准：

- runtime-render capability 已回到 owner modules
- `src/query-engine-executor.ts` 已退回 capability graph 分发器
- tools facade 只保留参数归一化、contract 适配与错误边界
- store / tech / customer 家族的结构化查询与运行时渲染不再维持第二份同构实现
- 已补一刀：
  - `get_customer_profile` 的 structured lookup 已从 `src/tools/handlers.ts` 回收到 `src/customer-profile.ts`
  - tool handler 现在只做参数校验、错误边界与 contract 适配
- 已再补一刀：
  - `get_member_recall_candidates` 的 structured lookup 已从 `src/tools/handlers.ts` 回收到 `src/customer-query.ts`
  - reactivation queue / feature / strategy 的 structured payload 现在由 owner module 统一产出
  - tool handler 只保留 store context、limit 归一化与错误边界
- 已继续补一刀：
  - `get_store_daily_summary` / `get_store_risk_scan` 的 structured lookup 已从 `src/tools/handlers.ts` 回收到 `src/store-query.ts`
  - 门店日汇总与风险扫描的结构化 payload、阈值与窗口快照现在由 owner module 统一产出
  - tool handler 进一步收敛为参数归一化、store context 与错误边界
- 已继续补一刀：
  - `store_metric_breakdown_runtime_v1` 的钟数构成运行时拼装已开始下沉到 `src/store-query.ts`
  - `store_advice_v1` 的 “复购还是储值” tradeoff 运行时拼装已开始下沉到 `src/store-query.ts`
  - `store_report_v1` 的单日 daily-kpi fast path 已开始下沉到 `src/store-query.ts`
  - `src/query-engine-executor.ts` 现在优先委派给 store owner module，再保留旧 fallback 兜底
- 已继续补一刀：
  - `store_metric_summary_v1` 的单日 daily-kpi 摘要快路径已开始下沉到 `src/store-query.ts`
  - `store_compare_v1` 的单日跨店 / 跨日对比快路径已开始下沉到 `src/store-query.ts`
  - `src/query-engine-executor.ts` 对这两类能力也已优先委派 owner module，再保留复杂窗口 fallback
- 已继续补一刀：
  - `store_trend_v1` 的轻量趋势渲染已开始下沉到 `src/store-query.ts`
  - `store_anomaly_v1` 的轻量异常归因渲染已开始下沉到 `src/store-query.ts`
  - `store_ranking_v1` 的轻量门店排名渲染已开始下沉到 `src/store-query.ts`
  - 这三类能力目前优先承接：
    - 可由 daily-kpi / 日报快照稳定回答的轻量指标场景
  - 复杂窗口与更重语义仍保留 executor fallback，避免一次性大迁移
- 已继续补一刀：
  - `collectStoreWindowSummary` 已开始作为窗口汇总真相源下沉到 `src/store-query.ts`
  - `enumerateBizDates` / `resolvePreviousComparableFrame` 已开始以 `src/store-query.ts` 为权威实现
  - `src/query-engine-executor.ts` 当前对上述真相源已改为转发调用，不再自己维持独立实现
  - `store_trend_v1` / `store_anomaly_v1` / `store_ranking_v1` 也已切到新的窗口汇总真相源
- 已继续补一刀：
  - `hq_portfolio_overview_v1` 的多店组合渲染已开始下沉到 `src/store-query.ts`
  - `src/query-engine-executor.ts` 对 HQ portfolio 现在优先委派 owner module，再保留旧 fallback 兜底
  - `tryRenderStorePriorityTradeoffText()` 已改为转发 `src/store-query.ts` 的 owner 实现
  - `src/query-engine-executor.ts` 内部那批已被 owner 模块取代的 lightweight window / daily-kpi 聚合 helper 已删除，避免双份真相源继续漂移
- 已继续补一刀：
  - `renderStoreClockBreakdownRuntimeText()` / `renderStoreReportRuntimeText()` 已作为 owner helper 对外显式暴露
  - `src/query-engine-executor.ts` 的 `store_metric_breakdown_runtime_v1` / `store_report_v1` fallback 已直接调用 owner helper
  - 原来的 `renderTotalClockBreakdownText()` / `tryRenderSingleDayDailyKpiFastPath()` 空壳 wrapper 已删除
  - 单日日报快路径与钟数构成不再由 executor 维护第二份门店实现
- 已继续补一刀：
  - `store_metric_summary_v1` 现在已由 `src/store-query.ts` 同时承接：
    - 单日 daily-kpi fast path
    - 轻量窗口指标摘要
    - 无 daily-kpi 时回退 `collectStoreWindowSummary()` 的通用窗口真相源
  - `store_compare_v1` 现在已由 `src/store-query.ts` 同时承接：
    - 单日跨店 / 跨日 daily-kpi fast path
    - 窗口对比与前周期对比
  - `src/query-engine-executor.ts` 对 `store_metric_summary_v1` / `store_compare_v1` 已改成直接委派 owner module，不再保留同构 fallback
  - `store_metric_breakdown_runtime_v1` 也已改成直接委派 owner module；`store_report_v1` 的重复 fast-path fallback 已删除
  - `hq_portfolio_overview_v1` 也已改成直接委派 owner module，不再保留同构 fallback
  - `tryRenderStorePriorityTradeoffText()` 空转发 wrapper 已删除，executor 直接调用 owner tradeoff helper
- 已继续补一刀：
  - `store_report_v1` 现在已由 `src/store-query.ts` 同时承接：
    - 单日 daily-kpi report fast path
    - 区间窗口汇总 + 对比期 report 渲染
  - `store_trend_v1` / `store_anomaly_v1` / `store_ranking_v1` 现在已由 `src/store-query.ts` 统一承接：
    - 非 lightweight 的窗口真相源渲染
    - 不再区分 executor 内部轻量 / 重量两套实现
  - `store_risk_v1` / `store_advice_v1` 现在已由 `src/store-query.ts` 统一承接：
    - 多店 portfolio risk 排序
    - 单店 tradeoff 问题
    - 通用窗口风险与建议渲染
  - `src/query-engine-executor.ts` 对上述能力已改成 direct delegation：
    - `store_report_v1`
    - `store_trend_v1`
    - `store_anomaly_v1`
    - `store_ranking_v1`
    - `store_risk_v1`
    - `store_advice_v1`
  - 结果：
    - store query 家族在 runtime-render 平面的 owner boundary 进一步收口
    - executor 不再维持这几类能力的第二份同构 fallback
- 已继续补一刀：
  - `tech_leaderboard_ranking_v1` 已从 `src/query-engine-executor.ts` 下沉到 `src/tech-profile.ts`
  - `src/tech-profile.ts` 新增技师排名 owner 入口：
    - 统一负责 metric 解析
    - leaderboard 排序
    - tech ranking 文本渲染
  - `src/query-engine-executor.ts` 对技师排名已改成 direct delegation
  - 结果：
    - 技师画像 / 技师排名开始回到同一 owner module
    - executor 继续变薄，不再直接持有技师排名业务逻辑
- 已继续补一刀：
  - `src/query-engine-modules.test.ts` 已直接依赖 `src/store-query.ts` 的 `enumerateBizDates`
  - `src/query-engine-executor.ts` 不再 re-export：
    - `enumerateBizDates`
    - `collectStoreWindowSummary`
    - `resolvePreviousComparableFrame`
  - 结果：
    - executor 不再承担测试兼容 facade
    - store window 真相源进一步只保留在 owner module

## 6. 给 Function Calling 留标准接入口，但不放开自由执行

状态：done

已落地：

- ADR 已明确：
  - function calling 只能作为结构化入口
  - 不得绕过 capability graph / safe execution
- `src/tools/contracts.ts`
  - 新增 `HETANG_TOOLS_CONTRACT_VERSION`
  - 为每个 bounded tool 明确：
    - `entry_role`
    - `lane`
    - `owner_surface`
    - `semantic_capability_ids`
    - `arguments_schema`
    - `input_contract_notes`
  - `semantic_capability_ids` 改为由 query plan / capability graph 推导，不再手填漂移
- `src/tools/contracts.ts`
  - tools capabilities 现在额外显式声明：
    - `execution_boundary`
      - `entry_role = function_call_entry_adapter`
      - `access_mode = read_only`
      - `business_logic_owner = owner_modules`
- `src/tools/server.ts`
  - `/v1/tools/capabilities` 现在显式返回 tools HTTP 入口的 `request_dedupe`
- `src/tools/handlers.ts`
  - tools capabilities 改为直接使用统一 tool contract

结果：

- function calling / tool facade 不再只是“有几个名字的工具”
- 现在已经有了机器可读的 schema 与语义映射，可作为未来生产入口的标准 task sheet 契约

## 7. 把 bridge / inbound / query 三条入口的控制面统一

状态：done

已落地：

- `src/bridge/contracts.ts`
  - bridge capabilities 新增 `control_plane_contract_version`
- `src/app/message-entry-service.ts`
  - `describeCapabilities()` 暴露 control plane contract 版本
- `src/bridge/contracts.ts`
  - bridge capabilities 新增 `tool_contract_version` / `tool_count`
- `src/app/message-entry-service.ts`
  - `describeCapabilities()` 同时暴露：
    - `control_plane_contract_version`
    - `tool_contract_version`
    - `query_graph_version`
    - `tool_count`
- `src/bridge/contracts.ts`
  - bridge capabilities 新增：
    - `audit_surfaces`
    - `observability_streams`
    - `request_dedupe`
- `src/app/message-entry-service.ts`
  - 明确声明：
    - command / inbound 的 audit sink 与 persistence 语义
    - route compare / command audit / inbound audit 的 observability streams
- `src/bridge/server.ts`
  - `/v1/capabilities` 现在显式返回 bridge HTTP 入口的 request dedupe 规则与 TTL
- `src/app/admin-read-service.ts`
  - `getSchedulerStatus()` / `getQueueStatus()` 现在显式返回 Query API 读面的：
    - `entrySurface`
    - `observabilityStreams`
- `api/main.py`
  - `/api/v1/runtime/scheduler` / `/api/v1/runtime/queues` 现在显式返回：
    - `entry_surface`
    - `observability_streams`
- `src/tools/contracts.ts` / `src/tools/server.ts`
  - tools capabilities 现在显式返回：
    - `execution_boundary`
    - `request_dedupe`

结果：

- bridge / tools / query 三条入口都开始显式声明自己的：
  - entry boundary
  - audit / observability surface
  - dedupe policy 或 `none`
- 值班、联调和后续 agent 接入不再需要反查代码猜入口规则

## 8. 再决定是否需要 Redis 或更重的分布式能力

状态：done-for-now

已落地：

- ADR 与架构规则已明确：
  - Redis 不作为当前默认优化手段
  - 必须先出现真实 latency / coordination 证据

后续触发条件：

- 多实例部署常态化
- PostgreSQL serving 出现明确热点
- 本地 TTL cache 与 advisory lock 不再够用

---

## 本轮结论

这 8 步里：

- done: 1, 2, 3, 4, 5, 6, 7
- done-for-now: 8

下一轮如果还要继续优化，优先级应转向：

1. control plane / doctor / queue 的运营可观测性细化
2. serving semantic layer 的能力补齐，而不是继续搬 runtime-render 代码
3. 暂不扩基础设施，继续维持 PostgreSQL truth store + local cache 的极简方案

---

## 架构补充锚点：Ontos-lite

状态：approved-direction

说明：

- `Ontos` 思想已吸收进项目优化方向，但采用的是 **Ontos-lite**，不是完整 ontology 平台迁移
- 当前项目认可的最小吸收路径是：
  - `capability graph` 继续作为业务语义真相源
  - 增补 `conversation semantic state`
  - 增补 `semantic quality loop / semantic execution audit`
- 明确不做：
  - 新建第二套 ontology runtime
  - 用本体层替代 capability graph
  - 把 AI 记忆/BDI 平台化后再反向接管现有主链

对应文档：

- `docs/reviews/2026-04-17-ontos-for-htops-review.md`
- `docs/plans/2026-04-17-ontos-lite-semantic-state-design.md`
- `docs/plans/2026-04-17-semantic-quality-loop-design.md`
- `docs/plans/2026-04-17-ontos-lite-semantic-state-and-quality-loop-implementation-plan.md`

后续优化优先级里的含义：

1. 优先补语义状态与质量闭环，不另起平台
2. 优先增强 capability graph / semantic audit / doctor，而不是堆新中间层
3. AI 只在受控边界内读写 semantic state，不绕过 safe execution

---

## 最新验收快照

运行态核验（2026-04-16 晚）：

- `npm run cli -- -- hetang doctor`
  - authoritative pollers 已明确为：
    - `scheduled-sync`
    - `scheduled-delivery`
    - `analysis`
  - `scheduled poller lastRun 偏旧` 问题已消失；当前 doctor 与 API 都以 split poller 为准
- `curl -sf http://127.0.0.1:18890/api/v1/runtime/scheduler`
  - live API 已返回：
    - `contract_version`
    - `entry_surface`
    - `observability_streams`
    - split poller 状态
    - `report_delivery_upgrade_summary`
- `curl -sf -H 'x-htops-bridge-token: ...' http://127.0.0.1:18891/v1/capabilities`
- `npx vitest run src/store-query.test.ts src/tech-profile.test.ts src/customer-profile.test.ts src/customer-query.test.ts src/query-engine-modules.test.ts src/query-engine.test.ts`
  - `169` 个 query-plane / owner-boundary 相关测试全部通过
- `tail -n 120 /tmp/hetang-scheduled-worker.log`
  - 当前持续刷新 `scheduled-sync poller ok`
- `node --import tsx src/main.ts hetang doctor`
  - split poller 均为 `ok`
  - `Report delivery upgrades (7d): none`
  - 现已无 analysis dead-letter 历史残留：
    - `subscriber abandoned 0`
    - `dead-letters 0`
- `curl -sf http://127.0.0.1:18890/api/v1/runtime/queues | jq '.'`
  - analysis queue 与 doctor 一致，当前已收口为：
    - `subscriber_delivery.abandoned_count = 0`
    - `unresolved_dead_letter_count = 0`
    - `dead_letter_summary = null`
- `/hetang queue cleanup stale-invalid-chatid-subscriber [limit]`
  - 现已提供最小历史残留清理入口：
    - 只收口 `stale-invalid-chatid-subscriber`
    - 不 replay，不重新开放投递
    - live 已执行一次，清理结果：
      - `subscriber 4`
      - `job 4`
      - `deadletter 8`
- `psql ... mart_daily_store_reports`
  - 最近 3 天 `send_status` 全为 `sent`
  - 未见新增 `alert-only`
- `psql ... mart_daily_report_delivery_upgrades`
  - 当前为空；表示近期无 upgrade 事件，不表示 telemetry 缺失
- `node --import tsx scripts/summarize-route-compare.ts --service htops-bridge.service --since "today"`
  - `samples=0`
  - 当前仅表示今天还没有新的桥接路由样本，不构成异常
- `node --import tsx scripts/summarize-hermes-frontdoor.ts --service hermes-gateway.service --since "today"`
  - `Total events: 0`
  - 当前仅表示今天还没有新的 frontdoor 观测样本
  - bridge live capabilities 已返回：
    - `control_plane_contract_version`
    - `tool_contract_version`
    - `audit_surfaces`
    - `observability_streams`
    - `request_dedupe`
    - `tool_count`
    - `query_graph_version`
- `curl -sf -H 'x-htops-tools-token: ...' http://127.0.0.1:18892/v1/tools/capabilities`
  - tools live capabilities 已返回：
    - `execution_boundary`
    - `request_dedupe`
    - tool contract metadata
- `mart_daily_store_reports`
  - 最近日报 `send_status` 均为 `sent`
  - `alert-only` 残留数为 `0`
