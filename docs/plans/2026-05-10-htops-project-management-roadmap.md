# HTOPS 项目管理路线图

日期：2026-05-10
状态：current control plan
范围：荷塘悦色 5 店经营操作系统

## 1. 项目定位

HTOPS 不是报表工具，也不是通用聊天机器人。

当前项目目标是：

> 把荷塘悦色 5 家门店的经营事实、外部环境、语义问答、主动洞察和动作闭环，收成一个可部署、可审计、可持续使用的门店经营操作系统。

项目主线：

```text
数据可信 -> 问答可信 -> 主动洞察 -> 动作闭环 -> 学习进化
```

技术主线：

```text
Text -> Semantic Intent -> Capability Graph -> Serving Semantic Layer -> Safe Execution -> Answer / Action
```

经营主线：

```text
看清问题 -> 判断原因 -> 给出动作 -> 执行追踪 -> 复盘改进
```

## 2. 当前问题

最近项目推进主要是“看到缺口就补能力”：

- 补自然语言识别
- 补 semantic answerability
- 补数据覆盖 gate
- 补主动洞察
- 补外部环境
- 补天气、人口、POI
- 补 Docker、自启动、夜间回补

这些工作都有价值，但如果继续按功能点推进，会出现 4 个问题：

1. 版本边界不清：不知道哪一版可以交付。
2. 验收标准不清：很难判断“现在到底算不算完成”。
3. 优先级漂移：新想法不断插入，核心闭环迟迟没有收口。
4. 商业价值分散：能力很多，但未必能稳定证明“真的帮门店改善经营”。

所以从 2026-05-10 开始，项目切换为里程碑管理。

## 3. 里程碑

### M0：交付基线

目标：项目能干净部署、稳定运行、可回滚。

完成标准：

- GitHub 只保留交付相关文件。
- 本地临时文件、报表图片、PDF、缓存、密钥不进入交付包。
- Docker Compose 可以启动 Postgres、bridge、query-api、workers。
- systemd 开机自启动可用。
- `frpc.service` 不被项目任务影响。
- `npm run codex:doctor` 可以检查关键运行面。
- README 能让新接手的人部署和检查健康。

当前状态：`部分完成，需收口 Git 边界和交付说明。`

### M1：数据可信

目标：5 店核心经营数据、外部环境数据、同步进度都可查、可解释、可拒答。

完成标准：

- 2025-10 至今的核心经营接口覆盖率可查。
- 8 个上游 API 的同步状态、缺口和最近成功时间可查。
- 日报和问答在回答前能识别数据缺口。
- 外部环境第一阶段已落库：
  - 百度 3km POI
  - WorldPop 2025 人口
  - Open-Meteo 天气
  - 中国日历/节假日上下文
  - 派生外部环境特征
- 所有外部数据均标记 `source_type / truth_level / confidence`。

当前状态：`外部环境已初步完成；历史经营数据覆盖率仍需看板化。`

### M2：问答可信

目标：常见经营问题能稳定识别、稳定执行、答不出时明确说明原因。

完成标准：

- 100 个高频经营问题完成归类：
  `question family -> capability -> metric / segment -> recipe`
- 高频指标进入机器可读 contract。
- answerability gate 能区分：
  - 可回答
  - 槽位缺失
  - 数据缺口
  - 口径缺口
  - capability 缺口
  - 不支持边界
- 成本、利润、实时等位、外部竞品研究等高风险问题不再被误答。
- 任意自然语言问题至少能进入合理 lane，而不是只靠正则兜底。

当前状态：`语义骨架已推进；100 高频问题验收集仍需收口。`

### M3：主动洞察

目标：每天能主动发现 5 店经营痛点，而不是只报数字。

完成标准：

- 12 类 pain signal 进入 deterministic evaluator：
  - 营收下滑
  - 客流下滑
  - 充值变弱
  - 储值压力
  - 新客浪费
  - 技师依赖
  - 技师产能异常
  - 点钟率异常
  - 出勤异常
  - 反结异常
  - 折扣异常
  - 数据风险
- 5 店汇总日报只发群，单店日报发店长。
- 汇总日报结构固定为：
  1. 核心指标
  2. 今日最大问题
  3. 异常门店
  4. 可能原因
  5. 具体动作
- 主动洞察引用经营数据和外部环境变量，不做无依据推断。

当前状态：`方向明确，日报结构和 pain signal 接线仍需验收。`

### M4：动作闭环

目标：AI 从“说建议”进入“推动经营动作并追踪结果”。

完成标准：

- 至少打穿 1 条完整经营动作闭环。
- 推荐首条闭环：高余额沉睡会员唤回。
- 闭环包含：
  - 目标人群
  - 选择理由
  - 触达话术
  - 负责人
  - 执行状态
  - 回访/回店/消费/充值结果
  - 7/14/30 天复盘
- 动作效果进入后续推荐排序和话术优化。

当前状态：`尚未作为主版本闭环验收。`

### M5：学习进化

目标：系统能从失败问题、日报偏差、动作结果中持续改进。

完成标准：

- inbound audit / semantic audit 样本流稳定。
- 夜间复盘任务不再出现输入为 0 且无人知晓。
- doctor 对“复盘输入为 0”告警。
- semantic quality dashboard 可查最近 24h / 7d 失败样本。
- 每周从失败样本中生成 contract / template / capability 的升级任务。

当前状态：`已有质量循环骨架，治理节奏仍需固化。`

## 4. 当前 Sprint

Sprint 名称：经营可信基线
时间：2026-05-10 至 2026-05-16

本周只追 4 个结果：

1. 交付边界干净
   - 清理 GitHub 交付包
   - 明确不提交 `tmp/`、外部 PDF、图片缓存、密钥、运行时缓存
   - README 简化为“怎么部署、怎么检查、怎么用”

2. 数据覆盖可查
   - 输出 5 店 2025-10 至今核心接口覆盖率
   - 输出每日 03:00-04:00 补数进度
   - 缺口进入 doctor 或独立检查命令
   - 当前独立检查命令：

```bash
npm run coverage:data -- --start 2025-10-01 --end 2026-05-09
npm run coverage:data -- --start 2025-10-01 --end 2026-05-09 --json
```

   - 检查范围：
     - 原始核心接口：`1.2` 消费明细、`1.3` 充值明细、`1.4` 消费流水、`1.6` 技师上钟、`1.7` 技师推销
     - 派生层：会员日快照、顾客分层、转化队列、90 天画像

3. 问答验收集可跑
   - 固化 100 个高频问题初版
   - 每个问题绑定 family / capability / contract / expected behavior
   - 可回答和不可回答都必须有标准预期

4. 5 店汇总日报升级
   - 群里只发 5 店汇总
   - 单店日报只发对应店长
   - 汇总日报从“报数”改为“核心指标 + 问题 + 洞察 + 动作”

本周不做：

- 不新开成本模型。
- 不新开实时等位/待结账。
- 不继续横向扩大量外部数据源。
- 不做竞品复杂抓取。
- 不改 `src/runtime.ts` 职责边界。

## 5. Backlog 分层

### P0：必须先做

- Git 交付边界收口。
- 数据覆盖率检查。
- 100 高频问题验收集。
- 5 店汇总日报新版落地。
- 夜间补数进度自动检查。

### P1：紧接着做

- 高余额沉睡会员唤回闭环。
- 新客 7/30 天二访闭环。
- 充值变弱预警和动作建议。
- semantic audit / inbound audit 样本流修复。
- 语义质量 dashboard。

### P2：规划但暂不抢主线

- 高德 POI 交叉校验。
- OSM / Overture 开放 POI。
- 房价/小区价格。
- 竞品价格、评分、团购监控。
- 本地活动事件。
- 行业/政策/舆情上下文。

### P3：后置能力

- 成本模型。
- 利润模型。
- 可分配现金利润。
- 实时等位。
- 待结账。
- 多模态巡店图/票据/语音。
- 自有垂类模型微调。

## 6. 需求进入规则

所有新需求先进入 Backlog，不直接插队。

只有满足以下任一条件，才允许进入当前 Sprint：

1. 修复生产故障。
2. 阻塞当前 Sprint 验收。
3. 数据安全或权限风险。
4. 用户明确要求立即处理，且范围小于半天。

否则进入下周排期。

## 7. 验收方式

每个 Sprint 必须回答 5 个问题：

1. 本周交付了什么？
2. 哪些指标可以证明它可用？
3. 哪些测试/doctor 已通过？
4. 哪些风险仍然存在？
5. 下周只做哪 1-2 件最重要的事？

技术验收至少包括：

```bash
npx tsc --noEmit
npm run codex:doctor
docker compose --env-file .env.postgres -f docker-compose.postgres.yml -f docker-compose.app.yml ps
```

功能验收按目标追加对应测试：

- 数据覆盖：coverage/check 命令输出。
- 问答可信：100 高频问题验收集。
- 日报可信：5 店汇总报告样例。
- 动作闭环：名单、触达、回店、消费结果。

## 8. 当前版本命名建议

下一次收口版本建议命名：

```text
v0.3-store-world-model-baseline
```

该版本不追求“全能”，只证明：

- 数据可信
- 问答可控
- 日报有洞察
- 外部环境可解释
- 运行态可部署

## 9. 决策原则

1. 先闭环，再扩展。
2. 先确定性，再智能化。
3. 先经营动作，再炫技分析。
4. 先 5 店跑通，再谈规模化。
5. 先可交付版本，再继续加能力。

## 10. 2026-05-10 执行检查点

本轮先收口 P0 的“经营可信基线”，不继续横向新增外部数据源、成本模型或实时等位能力。

已完成并可复查：

- 数据覆盖可查：新增/使用 `npm run coverage:data -- --start 2025-10-01 --end 2026-05-09` 检查 5 店核心接口和派生层覆盖率。
- 夜间补数自动优先级：`1.4` 消费流水作为 `P0_USER_TRADE_CRITICAL`，排在历史核心事实补数之前；近期核心事实仍优先。
- 夜间运行面：`htops-nightly-priority-backfill.timer` 已启用，固定在上游窗口内运行，下一轮由 systemd 定时触发。
- 问答验收集：`semantic-operating-contract` 已要求至少 100 个高频问题绑定 answer template；route eval 已覆盖 HQ 风险、总部重点、店长问法等高频场景。
- HQ 问法分流：总部视角的 `ranking / risk / advice` 已在样本资产里拆开，`哪个店风险最大` 进入 `hq_portfolio_risk_v1`，`总部先救哪家` 进入 `hq_portfolio_focus_v1`。
- 5 店日报结构：`renderFiveStoreDailyOverview` 输出固定为经营雷达，保留核心指标，并突出痛点、异常门店、原因和具体动作。
- 高频问题业务目录：`docs/plans/2026-05-10-semantic-question-family-acceptance.md` 把 150 个自然问题收成可读的 family/capability/recipe 验收表。

本轮验证命令：

```bash
npx vitest run src/nightly-priority-backfill.test.ts src/project-data-coverage.test.ts
npx vitest run src/hq-portfolio-route-eval-fixture-builder.test.ts src/hq-portfolio-utterance-samples.test.ts src/route-eval.test.ts src/semantic-operating-contract.test.ts
npx vitest run src/five-store-daily-overview.test.ts src/app/reporting-service-five-store-overview.test.ts src/sync-orchestrator-five-store-overview.test.ts
npx tsc --noEmit
npm run codex:doctor
npm run coverage:data -- --start 2025-10-01 --end 2026-05-09 --json
node --import tsx scripts/nightly-priority-backfill.ts --dry-run --start 2025-10-01 --end 2026-05-09 --max-tasks 12 --skip-lock
systemctl is-active frpc.service
```

当前仍未完成：

- Git 交付边界最终清理和分组提交。
- 高余额沉睡会员唤回闭环主版本验收。
- semantic / inbound audit 的失败样本流和夜间复盘输入为 0 的持续监控。
