# Current Project Architecture Review

日期：2026-04-22
范围：回顾 `htops` 当前项目全貌、阶段进展、主链完成度与剩余风险

## 业务判断

`htops` 现在已经不是单点的“日报系统”或“企微问数机器人”。

更准确的定义是：

**一个已经形成初版骨架的门店经营智能系统。**

它当前已经同时覆盖：

- 经营事实读取
- 企微问数与权限
- 日报 / 周报 / 周图
- 顾客经营画像与召回执行
- 门店环境上下文
- 夜间语义质量与学习闭环

但它还不是完整世界模型，也还不是完整总部经营决策系统。当前更准确的状态，是：

**统一经营智能骨架已成型，最关键的几条主链已入生产可验状态，但行业态势层、统一 HQ 读链、经营智能复盘面仍未完成。**

## 当前状态

### 已进入主链的部分

- 经营事实层、日报周报、企微问数、customer growth 主链已稳定存在。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L7)
- 门店环境层已经接入天气、节气、门店外部知识，并以 bounded 方式进入 explanation 和部分 customer growth 调整。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L9)
- 顾客经营画像 owner path、画像读路径、bounded action bridge 已正式入链。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L11)
- 夜间学习进化层已经开始吸收画像 freshness、observation gap、action-hit gap 这类信号。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L13)

### 仍未完成的部分

- 行业态势层还没有 owner module、snapshot store 与稳定更新节奏。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L16)
- 宏观、资本、竞对长期信号还没有稳定采集与分类治理。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L18)
- 总部诊断、HQ 周报、world model read surfaces 还没有统一吃到顾客经营画像与行业态势层。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L20)

## 主要发现

### P0

1. **项目定位已经升级，但“统一总部决策面”还没有真正落地。**
当前设计已经把项目定位提升为经营智能系统，而不是日报 / 问数 / 召回的拼装体。[docs/plans/2026-04-21-operating-intelligence-full-stack-design.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-design.md#L23) 但实现计划里 `Task 5` 仍是 `partial`，说明“统一经营上下文 -> 日报 / 周报 / 总部诊断”这条读链还没打通。[docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md#L17)

2. **行业态势层仍是最大结构性空缺。**
实现计划明确标记 `Task 4` 为 `not started`，即行业态势 owner module / snapshot store 尚未落地。[docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md#L16) 这意味着系统现在更擅长回答“店内发生了什么”，但还不擅长回答“外部环境变了什么、总部应该如何配资源”。

3. **world model 的方向已经明确，但当前仍偏骨架而不是生产能力。**
`Operating World Model v1` 已经定义了 `world state / mechanism / simulation / decision / learning` 五层能力。[docs/plans/2026-04-21-operating-world-model-v1-implementation-plan.md](/root/htops/docs/plans/2026-04-21-operating-world-model-v1-implementation-plan.md#L5) 但该计划还停留在任务设计期，未见像 customer operating profile 那样的完成回写，因此当前 world model 更接近“架构方向已批准”，还不是“生产主链已收口”。

### P1

4. **顾客经营画像是当前最扎实的一条生产级主链。**
顾客经营画像实施计划 `Task 1` 到 `Task 8` 已全部完成。[docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md](/root/htops/docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md#L11) observation、signal、daily profile snapshot、bounded action bridge、world model customer_state 入口、nightly review 吸收都已经明确入链。[docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md](/root/htops/docs/plans/2026-04-21-customer-operating-profile-implementation-plan.md#L22)

5. **夜间学习闭环已经从“想法”变成“最小可观测控制面”，但还没升级成完整经营智能复盘引擎。**
4 月 18 日计划已经说明 `conversation semantic state -> semantic quality -> doctor` 与 `nightly review -> 学习闭环桥接` 已形成可见链路。[docs/plans/2026-04-18-three-mainlines-two-week-priority-plan.md](/root/htops/docs/plans/2026-04-18-three-mainlines-two-week-priority-plan.md#L9) 4 月 21 日 full-stack 计划又明确 `Task 7` 只是 `partial`，更完整的 doctor taxonomy 与经营智能复盘面仍待扩。[docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md#L19)

6. **生产可信度收口有实质进展，但现在是“看得更清楚”，不是“所有问题已消失”。**
高频经营问法路由、真实权限绑定、日报缺字段重建、日报 readiness 摘要都已进入当前收口项。[docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md](/root/htops/docs/plans/2026-04-21-operating-intelligence-full-stack-implementation-plan.md#L21) 代码里也已经把 `daily_report_readiness_summary` 接入 admin read 和 doctor。[src/app/admin-read-service.ts](/root/htops/src/app/admin-read-service.ts#L639) [src/ops/doctor.ts](/root/htops/src/ops/doctor.ts#L159) [src/runtime.ts](/root/htops/src/runtime.ts#L298) 但这只是把“scheduled worker 当天尾部自动补数是否真的完成”变成可观测事实，不等于 worker 稳定性问题已经彻底解决。

### P2

7. **门店外部知识已经有受控发布层，但外部数据工程底座仍在补。**
当前系统已有 `store_external_context_entries + AI-safe assembler`，能解决“外部知识能不能进运行时”的问题。[docs/plans/2026-04-21-store-master-data-and-external-intelligence-design.md](/root/htops/docs/plans/2026-04-21-store-master-data-and-external-intelligence-design.md#L7) 但设计也明确指出：门店物理主数据表、原始证据到快照的完整链路、外部数据进入稳定算法层，这三件事还没补齐。[docs/plans/2026-04-21-store-master-data-and-external-intelligence-design.md](/root/htops/docs/plans/2026-04-21-store-master-data-and-external-intelligence-design.md#L15)

8. **到店人数新口径已经进入算法设计，但展示面和解释面还需要持续收口。**
到店人数方案已改为 `consume-detail-first`，并明确新指标先以 shadow metrics 方式接入，而不直接替换旧 `customerCount` 语义。[docs/plans/2026-04-19-consume-detail-first-arrival-count-implementation-plan.md](/root/htops/docs/plans/2026-04-19-consume-detail-first-arrival-count-implementation-plan.md#L5) 这条思路是对的，但也意味着系统里短期内会并存“旧口径展示”和“新口径计算”的双状态，必须继续靠模板巡检和读链收口压掉认知偏差。

## 分模块完成度

| 模块 | 当前判断 | 说明 |
| --- | --- | --- |
| Ontos-lite 语义主链 | 已完成第一阶段 | 方向正确，保住 capability graph 真相源，不引第二套 runtime |
| 企微高频问数 | 已可生产使用 | 高频经营问法已补路由兜底，但仍以稳定问法为主 |
| 权限与门店 scope | 基本收口 | 真实人员 scope 已补回归覆盖，但 roster 仍需继续维护 |
| 日报 | 可生产运行 | 预估到店人数缺字段会自动重建；新增 readiness 控制面 |
| 周报 / 周图 | 已进入可推送骨架 | 已有正式 rollout 计划，但内容深度仍需持续优化 |
| 顾客经营画像 | 当前最强 | observation -> signal -> profile snapshot -> strategy/queue/intelligence 已闭环 |
| 召回执行 | 最小闭环已跑通 | 迎宾店已从 PPT 进入真实 smoke，但跨店规模化还未完全展开 |
| 门店环境层 | 已有基础能力 | 天气、节气、外部知识已入 explanation，竞对 / 门店事件仍待扩 |
| 门店主数据 / 外部观察底座 | 部分完成 | 方向明确，生产数据架构正在补，但不是全部已入链 |
| 行业态势层 | 未完成 | 当前最大空白 |
| HQ 统一经营诊断面 | 部分完成 | 仍缺统一 world model / industry context 读链 |
| 夜间学习进化层 | 部分完成 | 语义质量面已成，但经营智能级 taxonomy 还没补完 |
| world model | 方向已定，主链未成 | 目前更像已批准蓝图，而非完成交付 |

## 边界判断

当前架构最正确的一点，是始终没有放弃这条主线：

`Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer/Action`

并且 Ontos-lite 的吸收方式也是对的：

- 用 capability graph 做业务语义真相源
- 用 conversation semantic state 做最小上下文层
- 用 doctor / semantic quality 做最小质量闭环
- 不引入第二套 ontology runtime

这条边界在架构上是健康的。[docs/reviews/2026-04-17-ontos-for-htops-review.md](/root/htops/docs/reviews/2026-04-17-ontos-for-htops-review.md#L7)

## 下一阶段建议

### 先做

1. 做完行业态势层最小 owner module 和 snapshot store。
2. 打通统一经营上下文到 HQ 周报 / 总部诊断的稳定读链。
3. 继续扩 doctor taxonomy，把 data gap / context gap / decision gap / execution gap 全部纳入夜间复盘面。
4. 继续盯 scheduled worker 当天尾部自动补数，用 readiness 真相线做长期观察，而不是只看 poller 时间戳。

### 后做

1. 更强竞对 intelligence。
2. 更强 world model 场景推演。
3. 宏观、资本、平台风向等长期弱信号。

## 最终结论

当前项目的真实状态，不是“还在做 PPT”，也不是“已经全做完”。

更准确地说：

**它已经完成了经营智能系统的第一层骨架收口，并把顾客经营画像、企微经营问数、日报生产、夜间学习闭环这几条最关键主链推进到了可见、可验、可持续迭代的状态。**

**它现在最大的短板，不在门店内生经营，而在门店外部更大环境的稳定建模与总部统一决策面。**
