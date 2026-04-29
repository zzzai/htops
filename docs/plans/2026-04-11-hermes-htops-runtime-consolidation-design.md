# Hermes / htops 运行态收敛与工具化设计

**Goal:** 让 `荷塘AI小助手` 稳定地只由 Hermes 接管，并把 htops 从“被动接收 inbound bridge”升级为“供 Hermes 调用的经营数据工具层”。

**Architecture:** 维持当前分层不变：Hermes 负责渠道接入、普通问答、开放问题规划；htops 负责经营数据口径、查询计划、serving 命中和确定性结果。运行态上彻底移除 OpenClaw 的自启动参与，只保留 OpenClaw 兼容代码作为回滚层；集成上从单一 `/v1/messages/inbound` bridge，演进到 “Hermes -> htops Bridge + 标准业务工具面 + 异步 sidecar” 三层结构。

**Design Summary**

- `荷塘AI小助手` 的唯一在线运行入口收敛到 Hermes。
- OpenClaw 不再参与 bot 接管、消息接收、自启动恢复。
- OpenClaw 代码保留在仓库里，只作为兼容入口与紧急回滚层。
- Hermes 继续处理普通问题与开放问题。
- htops 继续处理经营数据内核，不内嵌 Hermes agent runtime。
- Hermes 与 htops 的主要契约，从单一 inbound bridge，扩展为：
  - 入站契约：Hermes -> htops Bridge HTTP
  - 出站契约：htops -> `hermes-send message send ...`
  - 工具契约：Hermes -> htops business tool facade
  - 异步契约：htops worker -> Hermes sidecar

## 一、现状问题

### 1.1 运行态混线

当前机器上同时存在：

- `hermes-gateway.service`
- `openclaw-gateway.service`
- 旧 watchdog 仍可能通过 `.env.runtime` 中的 `HETANG_GATEWAY_SERVICE_NAME=openclaw-gateway.service` 拉起 OpenClaw
- 两套 Hermes 运行态痕迹：
  - `/root/htops/.hermes-runtime`
  - `/root/.hermes`

这会造成最严重的问题不是“慢”，而是“消息到底进了谁”，表现为：

- 企微里 bot 仍可见
- systemd 显示 Hermes 活着
- 但当前 Hermes 日志没有收到用户新消息
- 用户感知为“有时回、有时不回”

### 1.2 bot 归属不透明

当前 Hermes 启动脚本优先从全局凭据文件读取企微 bot 凭据，而不是在项目运行态里明确打印和绑定唯一 bot 身份。这导致：

- 运行态和 bot 归属难以肉眼确认
- 切换网关时容易误判“已经切过去了”
- 运维时无法快速判断当前实例接的是哪个 bot

### 1.3 集成层还不够强

当前 Hermes 与 htops 的集成，主要还是：

- 普通问题留在 Hermes
- 经营问题通过 `inbound bridge` 转给 htops

这已经比“全部打进 htops”更好，但仍不够强，因为：

- Hermes 不能稳定调用 htops 的标准业务能力
- 开放问题只能靠 Hermes 自己回答，或者整个转发
- 缺少“规划在上层、执行在下层”的清晰工具面

## 二、设计目标

这次设计同时解决两个层级的问题。

### 2.1 P0 运行稳定性目标

- `荷塘AI小助手` 只由 Hermes 接管
- OpenClaw 不再自启动
- 旧 watchdog 不再拉起 OpenClaw
- 当前 Hermes 启动时能明确打印：
  - runtime home
  - bot id 摘要
  - bridge 模式
  - 当前路由模式
- 普通问题必须稳定落到 Hermes
- 经营问题必须稳定通过 bridge 进 htops

### 2.2 P1 能力演进目标

- Hermes 不只当网关
- Hermes 作为上层 agent/runtime，负责：
  - 理解问题
  - 判断是否需要经营数据
  - 拆问题
  - 追问缺信息
  - 组织最终回答
- htops 作为经营数据工具层，负责：
  - 指标口径
  - 语义约束下的查询计划
  - serving 表命中
  - 结果返回

## 三、备选方案

### 方案 A：继续双网关并存

保留 Hermes 和 OpenClaw 都在线，只通过 bot 或配置区分职责。

优点：

- 回滚简单
- 迁移期风险低

缺点：

- 会持续出现“到底谁在回”的问题
- 日志和故障面长期混乱
- 运维心智负担最大

### 方案 B：推荐方案，运行态彻底收敛，代码兼容保留

- Hermes 成为唯一在线网关
- OpenClaw 停止并禁用自启动
- OpenClaw 兼容代码保留
- 通过标准业务工具面增强 Hermes -> htops 集成

优点：

- 运行面干净
- 回滚仍有抓手
- 最符合当前项目边界

缺点：

- 需要补一轮启动、路由、日志与测试

### 方案 C：把 Hermes 直接嵌进 htops runtime

优点：

- 单体看似简单

缺点：

- 打穿当前边界
- 让 htops 同时承担对话 agent/runtime 复杂度
- 破坏现有“业务内核可独立运行”的方向

### 结论

采用 **方案 B**。

## 四、目标架构

```text
WeCom
  -> Hermes Gateway
    -> 普通问题：Hermes 直接回答
    -> 经营问题：Hermes 路由到 htops Bridge
      -> message-entry-service
        -> command / inbound
          -> runtime facade
            -> store / serving / query / analysis
              -> PostgreSQL

Hermes 额外可调用：
  -> htops business tool facade
     -> get_store_daily_summary
     -> get_member_recall_candidates
     -> get_customer_profile
     -> get_store_risk_scan
     -> explain_metric_definition

htops worker
  -> hermes-send
  -> Hermes
  -> WeCom
```

## 五、P0：运行态收敛设计

### 5.1 唯一在线网关

- 禁用 `openclaw-gateway.service`
- 保留 systemd 文件但不启用
- `.env.runtime` 中不再允许：
  - `HETANG_GATEWAY_SERVICE_NAME=openclaw-gateway.service`
  - `HETANG_GATEWAY_DIST_ENTRY=/root/openclaw/dist/index.js`
  - 任何会让 watchdog 拉起 OpenClaw 的配置

### 5.2 唯一 runtime home

项目运行态统一使用：

- `/root/htops/.hermes-runtime`

不再把生产排障建立在 `/root/.hermes` 的历史状态之上。允许 `/root/.hermes` 保留，但明确视为“非当前项目运行态”。

### 5.3 启动可观测性

Hermes gateway 启动时必须打印：

- `runtime_home`
- `bot_id_suffix`
- `bridge_url`
- `route_mode=general_on_hermes,business_on_htops`
- `openclaw_runtime=disabled`

这样以后遇到“不回复”，第一眼就能看到当前实例接的到底是谁。

### 5.4 路由可观测性

当前 `sitecustomize.py` 已经能把普通问题留给 Hermes，把经营问题送去 htops。下一步只补日志：

- Hermes 本地回答：`route=hermes-general`
- bridge 转发成功：`route=htops-bridge`
- bridge 命中但未处理：`route=htops-bridge-noop`
- slash command：`route=command`

## 六、P1：htops 工具面设计

### 6.1 为什么要有工具面

仅靠 inbound bridge 的问题在于：

- Hermes 只能“整句转发”
- 无法把一个复杂问题拆成多次稳定调用
- 无法把开放问题和确定性查询结合起来

工具面要解决的是：

- Hermes 可以先规划
- 然后调用稳定、可测、可审计的 htops 能力

### 6.2 第一批标准工具

#### `get_store_daily_summary`

输入：

- `store_name`
- `biz_date`

输出：

- 单店日经营摘要
- 关键 KPI
- 同比/环比可用时附加

#### `get_member_recall_candidates`

输入：

- `store_name`
- `segment`
- `limit`

输出：

- 召回优先级名单
- 分层标签
- 推荐跟进理由

#### `get_customer_profile`

输入：

- `store_name`
- `member_id | phone_suffix | customer_name`

输出：

- 顾客画像
- 消费/储值/召回特征
- 风险与建议

#### `get_store_risk_scan`

输入：

- `store_name`
- `window`

输出：

- 风险摘要
- 主要异常指标
- 动作建议

#### `explain_metric_definition`

输入：

- `metric_name`

输出：

- 指标口径解释
- 时间范围
- 适用门店/维度

### 6.3 实现边界

工具面不是让 AI 直接拼 SQL，而是：

- Hermes 调用 bridge/tool facade
- htops 将输入映射到已存在查询/serving/语义计划
- 结果按结构化 JSON 返回

## 七、P2：异步高级能力设计

这一层不放进核心查询链路，只作为 sidecar：

- 外部情报
- 网页采集
- 竞品观察
- 长链路研究

方式：

- htops worker 发异步任务
- Hermes sidecar 执行 agent/web/skills/delegation
- 结果写回 htops 或直接发送

原则：

- 不污染核心经营查询链路
- 不让高波动外部能力影响 KPI 问答稳定性

## 八、OpenClaw 的保留策略

保留：

- [adapters/openclaw/index.ts](/root/htops/adapters/openclaw/index.ts)
- OpenClaw 兼容入口代码
- 回滚所需的配置与说明

不保留在线职责：

- OpenClaw 自启动
- OpenClaw 接管 `荷塘小助手`
- watchdog 恢复 OpenClaw

一句话：

**保留代码，不保留主运行权。**

## 九、测试与验收

### 9.1 P0 验收

- OpenClaw 服务禁用后不会被 watchdog 拉起
- Hermes 启动时输出唯一 bot 标识与 runtime home
- 普通问题进入 Hermes 日志
- 经营问题进入 htops bridge 日志
- 同一 bot 不再出现“消息发出但当前 Hermes 实例没收到”的混线

### 9.2 P1 验收

- 新工具接口有契约测试
- Hermes 可以稳定调用第一批 htops 工具
- 开放式经营问题能由 Hermes 拆解后命中 htops 工具
- 指标回答仍保持 htops 口径一致性

## 十、实施顺序

1. 先做运行态收敛
2. 再做启动与路由可观测性
3. 再做第一批工具面
4. 最后接入异步高级能力 sidecar

## Acceptance Criteria

- `荷塘小助手` 运行态唯一入口为 Hermes。
- `openclaw-gateway.service` 不再自启动，不再被 htops watchdog 拉起。
- 项目运行态只以 `/root/htops/.hermes-runtime` 为准。
- Hermes 启动日志明确打印 bot 归属与路由模式。
- 新增第一批 htops tool facade 契约与测试。
- Hermes 能先规划，再稳定调用 htops 工具返回经营结果。
