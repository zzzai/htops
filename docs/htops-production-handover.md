# htops 正式生产交付与部署手册

## 1. 文档目的

本文档用于将 `htops` 主仓库正式交付给外部技术团队，使对方在自带上游 API 与企微通道的前提下，能够：

1. 理解项目定位、系统边界与主要模块。
2. 在自己的服务器上完成正式生产部署。
3. 根据自己的上游 API 协议与企微发送链路完成接入适配。
4. 独立完成上线、验收、运维、升级与故障排查。

本文档面向混合读者编写，默认读者包括：

- 技术负责人 / 架构负责人
- 后端开发 / 实施工程师
- 运维 / DevOps

---

## 2. 项目介绍

### 2.1 项目定位

`htops` 可以简单理解成：**把门店经营数据接到本地，再把这些数据变成可查询、可复盘、可推送、可协同的经营系统。**

它不是一个单点报表脚本，也不是一个只会回复问题的聊天机器人。

它的基本工作方式是：

1. 从上游业务系统取经营事实
2. 同步到本地 PostgreSQL
3. 在本地做指标、报表、控制面和问答能力
4. 把结果发给 HQ、店长、企微群或外部接口

所以，对外最容易理解的一句话是：

`上游经营事实 -> 本地经营事实层 -> 经营控制与执行闭环 -> 输出与协同界面`

报表只是它的一种输出，不是它的全部。

### 2.2 业务架构

从业务视角看，`htops` 可以拆成五个连续环节：

| 业务环节 | 负责什么 | 输入 | 输出 | 是否使用 AI |
|---|---|---|---|---|
| 上游经营事实接入 | 接收门店经营相关原始事实 | 会员、消费、充值、账户变动、技师履约、营销提成等上游数据 | 原始同步批次、原始行审计 | 否 |
| 本地经营事实层 | 标准化、落库、形成可追溯事实层 | 上游原始业务事实 | PostgreSQL 事实表、mart 派生表 | 否 |
| 经营控制与调度层 | 负责营业日切分、同步窗口、任务编排、数据 readiness、异常降级 | 本地事实层状态、配置、时间窗 | 调度结果、控制面状态、可执行任务 | 否 |
| 决策与执行闭环 | 负责 HQ 管控、门店动作、顾客经营、执行反馈 | 事实层 + 控制面 + 部分语义输入 | 动作建议、执行任务、结果反馈、增长闭环 | 部分使用 |
| 输出与协同界面 | 向外提供业务结果与协同能力 | 事实层、控制面、执行闭环结果 | 问答、推送、排行榜、HQ 总览、报表、只读 API | 部分使用 |

如果只看主骨干，可以把它理解成三步：

1. 先把经营事实同步和落库做好
2. 再把本地控制、执行和调度做好
3. 最后把结果通过问答、报表、推送和只读接口交付出去

### 2.3 技术架构

从工程实现视角看，当前仓库可以拆成七层：

| 技术层 | 主要模块 | 作用 | 是否使用 AI |
|---|---|---|---|
| 上游 API 适配层 | `src/client.ts` `src/normalize.ts` | 对接上游 API、清洗原始字段、构造标准记录 | 否 |
| 同步编排层 | `src/sync.ts` `src/service.ts` | 组织同步波次、切分时间窗口、控制执行顺序 | 否 |
| 本地事实与派生层 | `src/store.ts` PostgreSQL | 保存原始事实、派生指标、日报缓存、控制面状态 | 否 |
| 业务服务层 | `src/app/*` | 报表、顾客经营、外部情报、控制面摘要、分析服务 | 部分使用 |
| 运行与调度层 | scheduled worker / analysis worker | 跑同步、调度、分析、投递任务 | 部分使用 |
| 对外服务层 | Query API / Bridge / notify adapter | 读面接口、入站入口、消息投递 | 部分使用 |
| AI 增强层 | semantic intent / capability graph / ai lanes / analysis service / quality loop | 负责语义理解、能力选择、异步分析、弱信号解释、质量复盘 | 是 |

### 2.4 AI 技术框架与边界

为了让接手方正确理解 `htops` 的 AI 位置，需要明确三件事：

#### 2.4.1 Bounded AI Harness

`htops` 不是把模型直接接到业务事实上，而是通过受控运行框架组织 AI 的参与方式。这个框架可以理解为一个 bounded AI harness：

- 业务事实先进入本地事实层
- AI 只能在被允许的入口和链路中工作
- AI 的输入、输出、回退路径、超时和执行面都受系统控制

在工程上，这个 harness 主要体现为：

- 明确的 worker 分层
- 显式的调度与执行边界
- 受控的 query / analysis lane
- 事实层与投递层的硬边界

#### 2.4.2 Ontos-lite 语义骨架

`htops` 不采用重型 ontology runtime，但保留最小可演进的语义骨架，也就是 Ontos-lite 路径：

`Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution`

这意味着：

- 系统有语义入口，不只是关键词匹配
- 系统有能力图谱，不是把所有问题都丢给一个模型
- 系统有 serving truth layer，真相仍落在结构化事实和确定性执行上
- AI 可以理解问题，但不能跳过事实层直接改写真相

#### 2.4.3 Bounded AI Agent

当前仓库里的 AI 不是“全局 autonomous agent”，而是 bounded AI agent：

- 在语义入口做问题理解
- 在能力图谱上做能力选择
- 在 analysis worker 中做较重的异步分析
- 在外部情报与弱信号模块中做解释与聚合
- 在 semantic quality / review 中做质量复盘与优化建议

这些 agent 能力都被限制在确定性主链之外，不能越权写事实、跳过调度或直接替代业务口径。

### 2.5 各环节与 AI 的关系

为了避免接手方误判“哪里是强 AI 驱动、哪里不是”，可以用下面这张表理解：

| 环节 | AI 作用 | 是否有硬事实兜底 |
|---|---|---|
| 上游 API 适配 | 不参与 | 是 |
| 原始事实落库 | 不参与 | 是 |
| 指标、日报、周报、月报、总览的事实计算 | 不作为真相来源 | 是 |
| Query 入口的语义理解 | 用于理解问题和选路 | 是 |
| Capability Graph 路由 | 用于能力选择 | 是 |
| Serving Query / Runtime Render | 可带语义壳，但事实来自本地层 | 是 |
| Analysis Worker | 用于异步分析、解释、复盘 | 是 |
| 外部情报 / 弱信号解释 | 用于总结和解释 | 否，必须作为弱信号看待 |
| Reply Guard / Safe Execution | 不把 AI 当最终裁决者 | 是 |

对外可以把 `htops` 的 AI 定位概括为：

`Deterministic Core + AI Augmentation`

也就是：

- 经营事实、调度、执行、状态、投递是确定性主链
- 语义理解、能力选择、异步分析、弱信号解释是 AI 增强层

### 2.6 当前交付形态

当前仓库已经具备以下可见系统形态：

- PostgreSQL 作为事实层与派生层数据库
- Node.js 运行时负责同步、调度、报表、投递、分析任务
- Python FastAPI 只读查询 API
- 可选本地 bridge 用于外部消息入口接入
- systemd 服务脚本与 shell 包装脚本

### 2.7 当前不包含的内容

本次交付不默认包含以下外部能力：

- 对方自己的上游业务 API 服务
- 对方自己的企微消息网关 / 发送平台
- 对方自己的服务器与数据库基础设施
- 对方自己的监控、日志汇聚、告警平台

换句话说，本次交付的是：

`htops 主仓库 + 运行脚本 + 配置模板 + 部署方式 + 适配边界`

不是完整托管 SaaS。

---

## 3. 交付范围与责任边界

### 3.1 本次交付包含

- `htops` 主仓库源码
- Node.js 运行脚本
- Python 查询 API
- systemd 服务模板
- 配置模板 `htops.json.example`
- 部署与运维文档

### 3.2 接手方需要自行提供

- Linux 服务器
- PostgreSQL 实例
- Node.js / Python 运行环境
- 上游 API 凭证与访问地址
- 企微通道与机器人凭证
- 生产级日志、监控、备份与告警体系

### 3.3 责任划分

#### 仓库交付方负责

- 提供当前仓库可运行的主干代码
- 提供正式生产部署方式、配置说明、启动脚本、基本验收方法
- 明确哪些模块需要按接手方环境进行适配

#### 接手方负责

- 将自己的上游 API 接到 `htops`
- 将自己的企微发送链路接到 `htops`
- 为 PostgreSQL、服务进程、日志、备份和监控提供正式生产保障
- 对接手后的数据质量、接口稳定性、凭证安全和运维稳定性负责

### 3.4 一个非常关键的事实

`htops` 的报表质量高度依赖上游 API 的数据完整性与时序一致性。

如果上游 API 返回的数据缺失、延迟、重复或字段口径变化，`htops` 虽然可以做一定的告警、降级和 readiness 控制，但无法凭空替代上游系统修复事实层错误。

因此，正式生产责任边界必须明确：

- `htops` 负责同步、落库、派生、调度、投递。
- 上游 API 提供方负责原始业务事实的完整性、准确性和可追溯性。

---

## 4. 推荐生产部署形态

### 4.1 推荐拓扑

在正式生产环境中，推荐至少部署以下组件：

| 组件 | 语言/形态 | 是否必需 | 作用 |
|---|---|---:|---|
| PostgreSQL | 数据库 | 是 | 原始事实、派生事实、控制面状态、报表缓存 |
| Scheduled Worker | Node.js | 是 | 调度同步、构建报表、发日报、发总览、跑定时任务 |
| Analysis Worker | Node.js | 是 | 执行分析类后台任务 |
| Query API | Python FastAPI | 推荐 | 提供只读查询与运行状态读面 |
| Bridge | Node.js | 可选 | 接收外部消息入口并转给 htops |

### 4.2 组件职责

#### PostgreSQL

保存：

- 原始同步批次与原始行审计
- 会员、消费、充值、技师等事实表
- 日指标、日报、顾客经营画像、召回队列等派生表
- 调度状态、服务轮询状态、控制面摘要

#### Scheduled Worker

负责：

- 到点触发同步
- 构建日报 / 周报 / 月报 / 五店总览
- 执行发送任务
- 执行白天修复、回补与部分控制面任务

#### Analysis Worker

负责：

- 处理分析任务队列
- 执行较重的后台分析流程
- 与 Scheduled Worker 物理隔离，避免抢占主调度链路

#### Query API

负责：

- 暴露只读查询与控制面接口
- 提供健康检查接口
- 为管理面、运维面或外部服务提供稳定只读入口

#### Bridge

负责：

- 接收外部消息入口
- 将消息转换成 `htops` 可处理的命令 / inbound 请求

如果接手方暂时不需要外部消息入口，只需要定时报表与主动推送，则 Bridge 可以暂不部署。

---

## 5. 环境与依赖要求

### 5.1 操作系统

推荐：

- Ubuntu 22.04 LTS 或同等级 Linux 发行版

### 5.2 运行时

推荐版本：

- Node.js 22+，建议使用 24 LTS 级别
- Python 3.11 或 3.12
- PostgreSQL 14+

### 5.3 依赖工具

需要具备：

- `node`
- `npm`
- `bash`
- `systemd`
- `python3`
- `venv`

当前仓库通过 `tsx` 直接运行 TypeScript 源文件，因此即使不先打包 `dist/`，也可以直接在生产上以源码模式运行。

需要注意：

- 不要用 `npm ci --omit=dev`
- 源码模式运行依赖 `tsx`，而 `tsx` 当前在 `devDependencies` 中

### 5.4 网络要求

生产主机至少需要访问：

- 接手方自己的上游 API 地址
- PostgreSQL 地址
- 企微消息网关或机器人接口

如果需要使用外部模型服务或其他外部依赖，再额外开放对应出口。

---

## 6. 目录结构与关键文件

以下文件和目录是生产部署必须理解的部分：

| 路径 | 用途 |
|---|---|
| `htops.json` | 主配置文件 |
| `.env.runtime` | 运行时环境变量覆盖文件 |
| `src/main.ts` | CLI 入口 |
| `src/standalone-env.ts` | 独立部署环境装配 |
| `src/client.ts` | 上游 API 客户端适配点 |
| `src/normalize.ts` | 原始 API 数据标准化适配点 |
| `src/sync.ts` | 同步主流程 |
| `src/app/reporting-service.ts` | 日报/周报/月报/总览渲染与发送服务 |
| `src/notify.ts` | 消息发送适配入口 |
| `api/main.py` | Python 查询 API |
| `scripts/run-worker-service.ts` | Worker 启动入口 |
| `scripts/run-bridge-service.ts` | Bridge 启动入口 |
| `ops/systemd/*.service` | systemd 服务模板 |
| `ops/*.sh` | systemd 包装脚本 |
| `sql/provision-worker-roles.sql` | PostgreSQL 角色授权脚本 |

---

## 7. 上游 API 对接要求

### 7.1 抽象要求

这份文档不保留当前现网接口编号，只保留通用数据契约。

`htops` 至少需要以下八类上游数据域中的大部分，才能稳定产出日报、周报、月报和顾客经营能力：

1. 会员主档
2. 会员卡 / 储值卡主档
3. 消费明细
4. 充值明细
5. 账户流水 / 账户变动日志
6. 技师主档
7. 上钟 / 服务履约明细
8. 营销 / 推销 / 提成 / 规则配置类数据

### 7.2 当前默认客户端假设

当前默认实现位于 [client.ts](/root/htops/src/client.ts:1)，它假设上游 API 是：

- HTTP POST JSON
- 使用 `appKey + appSecret` 形式鉴权
- 支持按时间窗口拉取
- 某些数据域支持分页
- 返回体中存在数组行集合

如果接手方的上游 API 与此协议一致，则通常只需要配置，不需要重写同步框架。

### 7.3 如果上游 API 协议不同，需要改哪里

#### 只改 `src/client.ts`

适用场景：

- 接手方 API 的业务含义与当前一致
- 只是鉴权、URL、分页参数、返回结构不同

改造目标：

- 保持 `sync.ts` 仍拿到等价的原始行数组
- 不改变下游事实层和报表层

#### 改 `src/client.ts + src/normalize.ts`

适用场景：

- 返回字段名变化较大
- 某些关键字段含义与当前不完全一致

改造目标：

- 在 `normalize.ts` 中重新把原始字段映射到 `htops` 的内部记录结构
- 尽量不改 `store.ts`、`reporting-service.ts` 和 query / report 层

#### 改 `src/client.ts + src/normalize.ts + src/sync.ts`

适用场景：

- 接手方上游 API 的拉取模型与当前完全不同
- 不支持当前的时间窗口、分页、分域同步方式

改造目标：

- 保持最终写入本地事实层的数据结构不变
- 仅重写“如何拉数据”和“如何切分同步波次”

### 7.4 哪些部分通常不需要动

如果接手方只是适配自己的上游 API 或企微通道，通常**不需要**改以下部分：

- `Capability Graph`
- `Semantic Intent`
- `AI lane registry`
- `analysis worker` 的 bounded AI 编排逻辑
- `reply guard / safe execution` 的主边界

原因很简单：

- 上游 API 适配属于事实接入问题
- 企微通道适配属于投递问题
- 这两类改造都不应该反向破坏语义层和 AI 增强层的边界

因此，推荐的接手顺序永远是：

1. 先把上游事实接稳
2. 再把发送链路接稳
3. 最后再决定是否需要调整 AI 层能力

### 7.5 上游 API 的最低质量要求

接手方需要保证：

1. 同一业务事实可重复拉取，且具备稳定主键或可构造稳定指纹。
2. 同步窗口内的数据不会长期缺漏。
3. 时间字段具备稳定时区与业务日期解释方式。
4. 退款、冲销、反向单据、赠送、团购、储值、会员支付等方向能区分。
5. 技师履约与营销提成相关字段不能混淆。

如果这些条件不成立，`htops` 的指标、日报、月报都会出现失真。

### 7.6 对接完成后的最低验证

对接后至少要验证以下数据域是否可落库并形成业务产物：

- 至少 1 家门店的完整同步成功
- 该门店能生成一份 `complete=true` 的正式日报
- 同一营业日的消费、充值、技师履约与账户流水之间没有整体级别断裂
- 周报 / 月报 / 五店总览不会因为字段缺失而全面退化

---

## 8. 企微通道对接要求

### 8.1 当前发送边界

当前发送适配入口在 [notify.ts](/root/htops/src/notify.ts:1)。

`htops` 本身不要求必须沿用当前发送脚本，但要求接手方提供一个稳定的“消息发送能力”，至少满足：

- 能按目标通道和目标群发送 Markdown 文本
- 可返回明确的成功 / 失败结果
- 失败时可追踪错误原因

### 8.2 当前支持的两种接入方式

#### 方式 A：直接使用企微机器人脚本

当前仓库提供 [wecom-send-group.mjs](/root/htops/ops/wecom-send-group.mjs:1)。

适合：

- 接手方愿意直接复用当前机器人发送方式

需要提供：

- 机器人 ID
- 机器人 Secret
- 目标群标识

#### 方式 B：接到自己的消息网关

适合：

- 接手方已有自建网关、消息总线或统一通知平台

接法：

- 通过 `HETANG_MESSAGE_SEND_ENTRY`
- 或 `HETANG_MESSAGE_SEND_BIN`
- 或修改 `src/notify.ts` 中的适配逻辑

建议：

- 保持 `htops` 输出“目标 + 文本内容”，不要让业务层感知对方网关内部细节

### 8.3 如果需要接收企微入站消息

若接手方需要店长 / HQ 在企微中发命令或发消息给 `htops`，则建议部署 Bridge：

- Bridge 服务：`18891`
- 关键鉴权头：`X-Htops-Bridge-Token`

如果只需要定时推送，不需要企微入站问答，则可以不部署 Bridge。

---

## 9. 部署前准备

### 9.1 服务器准备

至少准备：

- 1 台 Linux 服务器
- 1 个 PostgreSQL 数据库
- 可写日志目录
- systemd 可用

### 9.2 仓库准备

建议将仓库放在：

```bash
/home/<service-user>/htops
```

如果不沿用该路径，需要同步修改：

- systemd 服务文件中的 `WorkingDirectory`
- `HETANG_ROOT_DIR`
- `HTOPS_CONFIG_PATH`

### 9.3 配置文件准备

至少准备两个文件：

1. `htops.json`
2. `.env.runtime`

`htops.json` 用于主配置；`.env.runtime` 用于凭证和运行时覆盖。

### 9.4 Python Query API 虚拟环境

Query API 依赖 Python venv，需要执行：

```bash
bash ops/setup-query-api-venv.sh
```

---

## 10. 安装与部署步骤

### 10.1 获取源码

```bash
git clone <your-repo-url> htops
cd htops
```

### 10.2 安装 Node 依赖

```bash
npm install
```

如果接手方已有 `pnpm` 管理策略，也可以使用其自己的包管理规范；当前仓库默认能通过 `npm install` 安装依赖。

### 10.3 准备 Python Query API 环境

```bash
bash ops/setup-query-api-venv.sh
```

完成后会生成：

```bash
api/.venv
```

### 10.4 准备 PostgreSQL

创建数据库后，建议为 worker 角色单独授权。

可参考：

[provision-worker-roles.sql](/root/htops/sql/provision-worker-roles.sql:1)

至少需要：

- 一个数据库，例如 `htang_ops` 或 `htops`
- 可写角色用于同步与分析
- Query API 可读连接串

### 10.5 创建 `htops.json`

从模板复制：

```bash
cp htops.json.example htops.json
```

然后至少填写：

- `api.appKey`
- `api.appSecret`
- `database.url`
- `stores`
- `reporting.sharedDelivery`

如果接手方上游 API 协议不同，则这里的 `api` 段只保留对他们自己的客户端实现有意义的字段。

### 10.6 创建 `.env.runtime`

建议在仓库根目录创建：

```bash
.env.runtime
```

推荐至少包含：

```bash
HETANG_ROOT_DIR=/home/<service-user>/htops
HTOPS_ROOT_DIR=/home/<service-user>/htops
HTOPS_CONFIG_PATH=/home/<service-user>/htops/htops.json
HTOPS_STATE_DIR=/home/<service-user>/.htops

HETANG_DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
HETANG_QUERY_DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
HETANG_SYNC_DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
HETANG_ANALYSIS_DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>

HETANG_QUERY_API_HOST=127.0.0.1
HETANG_QUERY_API_PORT=18890

HETANG_BRIDGE_HOST=127.0.0.1
HETANG_BRIDGE_PORT=18891
HETANG_BRIDGE_TOKEN=<replace-with-strong-token>

HETANG_WECOM_BOT_ID=<replace-if-direct-wecom-mode>
HETANG_WECOM_BOT_SECRET=<replace-if-direct-wecom-mode>
```

### 10.7 部署 systemd 服务

将以下服务文件部署到目标主机：

- `ops/systemd/htops-scheduled-worker.service`
- `ops/systemd/htops-analysis-worker.service`
- `ops/systemd/htops-query-api.service`
- `ops/systemd/htops-bridge.service`（如果需要）

完成后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable htops-query-api.service
sudo systemctl enable htops-scheduled-worker.service
sudo systemctl enable htops-analysis-worker.service
sudo systemctl enable htops-bridge.service
```

如果不需要 Bridge，则不要 enable `htops-bridge.service`。

当前模板中的 `User=root` / `Group=root` 是交付时的保守默认值。正式生产建议改为专用服务账号，例如：

- `User=htops`
- `Group=htops`

同时保证该账号对以下路径有访问权限：

- 仓库目录
- `htops.json`
- `.env.runtime`
- Query API venv
- 日志目录

### 10.8 启动服务

```bash
sudo systemctl start htops-query-api.service
sudo systemctl start htops-scheduled-worker.service
sudo systemctl start htops-analysis-worker.service
sudo systemctl start htops-bridge.service
```

---

## 11. 配置说明

### 11.1 `htops.json` 关键段

#### `api`

定义上游 API 客户端配置。若接手方沿用当前协议，可直接填写地址与凭证；若不沿用，则接手方需要按自己的客户端实现解释该段。

#### `database`

定义 PostgreSQL 连接。建议显式配置：

- `url`
- `queryUrl`
- `syncUrl`
- `analysisUrl`

#### `sync`

控制同步窗口、营业日切分与重叠策略。

关键项：

- `enabled`
- `initialBackfillDays`
- `overlapDays`
- `runAtLocalTime`
- `accessWindowStartLocalTime`
- `accessWindowEndLocalTime`
- `businessDayCutoffLocalTime`

#### `reporting`

控制日报、周报、月报、周图、午报、唤回推送等时间与开关。

关键项：

- `buildAtLocalTime`
- `sendAtLocalTime`
- `weeklyReportAtLocalTime`
- `weeklyChartAtLocalTime`
- `middayBriefAtLocalTime`
- `reactivationPushAtLocalTime`
- `sharedDelivery`

#### `stores`

列出门店 `orgId`、标准门店名、别名与启停状态。

### 11.2 环境变量覆盖逻辑

`src/standalone-env.ts` 会自动从：

- `htops.json`
- `.env.runtime`
- 进程环境变量

组合出最终运行配置。

常见覆盖顺序建议：

1. `htops.json` 放静态结构
2. `.env.runtime` 放敏感凭证与环境差异
3. systemd `EnvironmentFile` 引用 `.env.runtime`

---

## 12. 服务启动顺序与健康检查

### 12.1 推荐启动顺序

1. PostgreSQL
2. Query API
3. Scheduled Worker
4. Analysis Worker
5. Bridge（如果需要）

### 12.2 基础健康检查

#### Query API

```bash
curl -fsS http://127.0.0.1:18890/health
```

#### systemd 状态

```bash
systemctl is-active htops-query-api.service
systemctl is-active htops-scheduled-worker.service
systemctl is-active htops-analysis-worker.service
systemctl is-active htops-bridge.service
```

#### CLI 自检

```bash
npm run cli -- hetang status
```

或：

```bash
node --import tsx src/main.ts -- hetang status
```

### 12.3 首次联通性检查

至少执行以下一次性验证：

```bash
npm run cli -- hetang status
npm run cli -- hetang sync --org <one-org-id>
npm run cli -- hetang report --org <one-org-id> --date <biz-date>
```

---

## 13. 验收清单

正式生产交接至少要通过以下验收：

### 13.1 环境验收

- `npm install` 成功
- Query API venv 安装成功
- PostgreSQL 连通正常
- `htops.json` 能被成功加载

### 13.2 服务验收

- Query API 服务可启动并返回健康状态
- Scheduled Worker 服务可启动
- Analysis Worker 服务可启动
- Bridge 服务可启动（如果启用）

### 13.3 数据验收

- 至少 1 家门店完成一次完整同步
- 原始数据可写入事实层
- 可生成 1 份 `complete=true` 的正式日报
- 周报、月报不会因字段缺失直接崩溃

### 13.4 消息验收

- 能向测试群发出一条测试消息
- 能发送 1 份单店日报
- 能发送 1 份 HQ 级总览 / 周报 / 月报中的任意一种

### 13.5 运行验收

- 定时 worker 至少跑过一轮
- `doctor` 能看到服务状态和关键摘要
- 日志中没有明显的持续重启或数据库连接失败

---

## 14. 日常运维

### 14.1 常用命令

#### 健康检查

```bash
npm run cli -- hetang status
```

#### 手动增量同步

```bash
npm run cli -- hetang sync --org <orgId>
```

#### 手动生成日报

```bash
npm run cli -- hetang report --org <orgId> --date <YYYY-MM-DD>
```

#### 手动 dry-run 月报

```bash
npm run report:monthly -- --month <YYYY-MM> --dry-run
```

#### 手动执行到期任务

```bash
npm run jobs:run
```

### 14.2 推荐监控内容

至少监控以下项目：

- PostgreSQL 连接数与可用性
- Query API 进程状态
- Scheduled Worker 进程状态
- Analysis Worker 进程状态
- Bridge 进程状态（如果启用）
- 日志中的持续失败
- 同步时窗内是否长期无成功同步
- 日报是否持续卡在 `complete=false`

### 14.3 日志位置

当前 shell 包装脚本默认使用 `/tmp` 下日志文件，可根据接手方标准改到正式日志目录。

重点日志包括：

- Query API 日志
- Scheduled Worker 日志
- Analysis Worker 日志
- Bridge 日志

建议在生产上把这些日志统一接入：

- journald
- 文件日志轮转
- 或集中日志平台

---

## 15. 常见故障与排查

### 15.1 `doctor` 失败或数据库连不上

优先检查：

- PostgreSQL 是否启动
- `HETANG_DATABASE_URL` / `database.url` 是否正确
- 防火墙与监听地址是否允许访问

### 15.2 Query API 启动失败

优先检查：

- `api/.venv` 是否存在
- `python` 是否可执行
- `HETANG_QUERY_DATABASE_URL` 是否可解析
- `ops/hetang-query-api.sh` 中的日志输出

### 15.3 Worker 反复重启

优先检查：

- Node 版本是否符合要求
- `tsx` 依赖是否安装完整
- `htops.json` 是否可被解析
- `.env.runtime` 是否含有错误值或缺失关键值

### 15.4 报表生成成功但发送失败

优先检查：

- 企微凭证是否正确
- 目标群标识是否正确
- 自定义消息网关是否返回成功状态
- `src/notify.ts` 对接方式是否与接手方环境一致

### 15.5 同步成功但日报仍不完整

优先检查：

- 上游 API 是否真的提供了关键数据域
- 某些字段是否在 `normalize.ts` 中被错误映射
- 上游时间字段是否导致营业日切分错误
- 原始事实是否重复、缺失或严重延迟

### 15.6 月报 / 周报内容明显失真

优先检查：

- 上游原始事实是否完整
- 本地事实层是否存在长时间为零或缺漏的日期
- 某些门店是否存在只同步到部分数据域

`htops` 可以指出“基线不足”或“日报未完成”，但无法替上游补出不存在的事实。

### 15.7 Bridge 启动后返回未授权

优先检查：

- `HETANG_BRIDGE_TOKEN` 是否与调用方一致
- 外部请求是否带 `X-Htops-Bridge-Token`
- Bridge 是否只监听本地 `127.0.0.1`

---

## 16. 升级、回滚、备份恢复

### 16.1 升级建议

升级顺序建议：

1. 停止 Bridge / Worker
2. 备份数据库
3. 拉取新代码
4. 安装依赖
5. 如有 Python 改动，重建 Query API venv
6. 执行编译 / smoke check
7. 启动服务
8. 跑一轮 `doctor`

### 16.2 回滚建议

回滚至少具备：

- 上一个稳定代码版本
- 上一个稳定 `htops.json`
- 数据库备份或明确不回滚数据库的策略

如果此次升级修改了事实层写入逻辑或字段口径，回滚前必须明确：

- 是只回滚代码
- 还是代码与数据库一并回滚

### 16.3 备份建议

最少备份：

- PostgreSQL 数据库
- `htops.json`
- `.env.runtime`
- systemd 服务文件与修改记录

如果接手方把日志作为审计依据，也应一并纳入日志保留和归档策略。

---

## 17. 接手方建议的本地适配顺序

如果接手方要把自己的上游 API 与企微通道接进来，建议按下面顺序实施：

1. 先让 PostgreSQL、Query API、Scheduled Worker、Analysis Worker 跑起来。
2. 先只打通 1 家门店、1 份日报。
3. 再打通消息发送。
4. 再扩到全部门店。
5. 最后再接入 Bridge 与入站问答能力。

不要一开始同时改：

- 上游 API 协议
- 数据标准化
- 同步波次
- 报表模板
- 企微发送

这样很难定位问题。

---

## 18. 交接清单

正式移交前，建议双方至少逐项确认以下内容：

### 18.1 源码与配置

- 源码仓库地址
- 稳定分支或交付 tag
- `htops.json.example`
- `.env.runtime` 模板

### 18.2 环境与权限

- 生产服务器信息
- PostgreSQL 连接方式
- 上游 API 凭证
- 企微通道凭证
- systemd 管理权限

### 18.3 接口与改造点

- 上游 API 是否复用当前协议
- 若不复用，需要由谁改 `src/client.ts`
- 字段映射由谁改 `src/normalize.ts`
- 企微发送由谁改 `src/notify.ts` 或外部网关

### 18.4 上线与验收

- 测试门店范围
- 首轮上线时间窗
- 首轮验收项
- 回滚预案负责人

---

## 19. 最后说明

`htops` 的核心价值不在于“把报表发出去”，而在于把上游业务事实稳定拉到本地、在本地建立可追溯的经营事实层，再围绕这层事实做报表、问答、推送和控制面。

因此，接手方在正式生产部署时，最应该保护的是三件事：

1. 上游 API 的事实质量
2. PostgreSQL 本地事实层的稳定性
3. 同步、报表、投递三条生产链路的可观测性

只要这三层稳定，`htops` 就能长期演进；如果这三层不稳定，再漂亮的报表和问答表面都会失真。
