# 5店昨日经营总览（店长共看版）设计文档

日期：2026-04-23
状态：approved
范围：在单店日报发送完成后，为 5 店店长群追加一份“昨日经营总览”，让所有店长看到横向对比、差距拆解和今日动作

## 背景

当前 `htops` 已经有两类相对扎实的读面：

- 单店日报：告诉每位店长“自己店昨天怎么样”
- 5 店周报 / 周图：告诉总部“这一周 5 店整体怎么走、下周怎么调”

但中间还缺一层非常关键的共享读面：

**单店日报之后，面向所有店长共看的 5 店横向总览。**

这份东西不是 HQ 周报，也不是实时午间看板，而是：

- 基于前一营业日的稳定事实
- 在单店日报都发送完成后再发送
- 帮助店长看到：
  - 自己店在 5 店里处于什么位置
  - 差距主要在量盘还是质量
  - 哪些门店值得复制
  - 自己今天最该补哪一刀

## 为什么现在要做

如果只有单店日报，店长容易陷入“只看自己”：

- 知道昨天自己店营收多少
- 但不知道在 5 店里到底是高还是低
- 不知道问题是行业共性，还是本店承接断点
- 也不知道哪些门店动作值得当天复制

如果直接看 HQ 周报，又会太重、太偏总部判断，不适合每天执行。

因此需要一张介于两者之间的共享战报：

**让 5 家店长先看对比，再看差距，再看动作。**

## 设计目标

本次设计必须同时满足 6 点：

1. 不替代单店日报，而是日报后的第二层共享读面
2. 基于前一营业日稳定数据，不做半天实时口径
3. 面向店长共看，不写成 HQ 口吻
4. 重点是横向对比、差距拆解和今日动作，不只是排名
5. 不新建第二套 truth source，继续复用 PostgreSQL / daily report / serving metrics
6. 不把新职责继续堆进 `src/runtime.ts`

## 当前真实状态（2026-04-23）

这条线当前已经不是纯设计状态，而是“最小闭环已落地、但仍需补强”：

- 已有 deterministic renderer，固定输出 6 段结构：一句话总览、量盘对比、质量对比、上周同期变化、差距拆解、今日动作
- 已有 `reporting-service` 组装链路，直接从已完成的单店日报读取 `DailyStoreReport.metrics`
- 已有上周同期基线逻辑，默认取 `bizDate - 7`
- 已有 `preview -> pending_confirm -> confirm/cancel` 发送闸门；若未配置共享目标，则明确返回 `skipped`
- 已有调度 job `send-five-store-daily-overview`，默认在 `send-report` 后安全等待
- 已有 runtime / CLI 的 `render / preview / cancel / confirm` owner-path 入口
- 已有 admin read / doctor 对该 job readiness 与最新状态的可观测摘要
- 已有 regression coverage，覆盖 renderer、service、schedule、orchestrator、runtime waiting 行为

但当前仍是第一阶段最小版本，不应误判为 fully landed：

- 还没有引入 external intelligence / 行业态势 / HQ 统一上下文
- 还没有持久化自己的 snapshot 或 delivery audit truth layer
- 还没有让 AI 参与主判断，仍是 deterministic-first

## 当前代码映射

这份总览当前对应的 owner modules 如下：

- renderer：`src/five-store-daily-overview.ts`
- renderer contract：`src/five-store-daily-overview.test.ts`
- service assembly / send：`src/app/reporting-service.ts`
- service regression：`src/app/reporting-service-five-store-overview.test.ts`
- schedule / waiting orchestration：`src/sync-orchestrator.ts`
- orchestrator regression：`src/sync-orchestrator-five-store-overview.test.ts`
- schedule config / job catalog：`src/config.ts` `src/schedule.ts` `src/control-plane-contract.json`
- shared runtime regression：`src/runtime.test.ts`

这也意味着：

- 它当前属于 reporting / delivery owner path，不属于 `runtime.ts` 新入口扩张
- 它当前复用日报事实面，不额外引入第二套横向分析 runtime
- 它当前是“日报后的共享读面”，不是 query 主链上的 HQ portfolio answer

## 方案对比

### 方案 A：纯排名榜

结构：

- 营收排名
- 客流排名
- 点钟率排名
- 加钟率排名

优点：

- 直观
- 成本低

缺点：

- 只能看到高低，看不到差距成因
- 不能直接转成今天动作
- 店长看完容易停留在“谁第一、谁倒数”

### 方案 B：HQ 周报缩短版

结构：

- 总盘判断
- 重点门店
- 总部动作

优点：

- 复用现有周报表达方式容易

缺点：

- 语气偏 HQ
- 不够贴店长日常执行
- 容易把“门店共读”做成“总部指挥”

### 方案 C：店长共看战报版

结构：

- 一句话总盘
- 量盘对比
- 质量对比
- 上周同期变化
- 差距拆解
- 今日动作

优点：

- 最贴近当前需求
- 既有横向比较，也能落到执行
- 与单店日报、5 店周报形成清晰分层

缺点：

- 需要一层新的共享 renderer 和共享投递调度

## 推荐方案

选择 **方案 C：店长共看战报版**。

原因：

1. 它最符合“日报之后，再给店长看横向差距和动作”的场景
2. 它不会把 5 店总览做成 HQ 周报 lite
3. 它比纯榜单更有经营指导价值
4. 它可以直接复用当前 `DailyStoreReport.metrics` 和日报调度链，不需要新建大表

## 正确定位

这份报表的正确定位是：

**荷塘悦色5店昨日经营总览（店长共看版）**

它回答的不是：

- “总部怎么看”
- “本周怎么调资源”

而是：

- “昨天 5 店整体是什么盘面”
- “我店在 5 店里差在哪”
- “今天先补客流、点钟、加钟还是钟效”
- “哪家店昨天的动作值得复制”

## 发送策略

### 1. 发送时机

不是中午实时发，也不是替代日报。

正确时机：

- 单店日报全部完成发送之后
- 再发送 1 条共享 5 店总览

这样使用顺序是：

1. 各店先看自己日报
2. 再看 5 店横向总览

### 2. 发送对象

面向所有店长共看的一份共享内容。

因此它更适合：

- 走 shared delivery
- 或走所有门店共用的统一群目标

第一版不建议按店分别生成不同版本。

### 3. 等待规则

默认应等待所有单店日报完成发送后再发。

原因：

- 如果某店日报还没完成，共享横向比较会失真
- 单店日报是这份总览的上游稳定事实面

因此它的调度关系应类似：

- `send-report` 完成
- 再触发 `send-five-store-daily-overview`

### 4. 预览闸门

当前该报表不再直接自动发到店长群。

第一版改为：

- 调度先发一份预览版到 `wecom:ZhangZhen`
- 同时把该次内容记成 `pending_confirm`
- 只有在当前控制窗口明确确认后，才正式群发到店长共看群

这样做的原因是：

- 这份总览是共享横向判断，误发成本高于单店日报
- 当前仍处于第一阶段，先由人控确认可以显著降低错误扩散
- 不需要改企微 inbound 审批流，就能得到一个稳定的 preview gate

### 5. 确认方式

第一版不走企微内回复确认，也不做自然语言自动审批。

只允许：

- 系统自动把预览发给 `张震`
- 操作者在当前控制窗口明确下达确认动作
- 系统读取同一 `runKey` 的待确认草稿并正式群发

### 6. 状态持久化

第一版不新建表，继续复用 `scheduled_job_state`。

建议把状态挂在：

- `job_type = send-five-store-daily-overview`
- `state_key = bizDate`

最小状态包括：

- `stage = pending_confirm | cancelled | sent | failed`
- `previewSentAt`
- `previewTarget`
- `finalTarget`
- `finalMessage`
- `finalMessageHash`
- `canceledAt`
- `canceledBy`
- `confirmedAt`
- `confirmedBy`
- `finalSentAt`
- `updatedAt`

其中最关键的原则是：

- **confirm 时不重新渲染正文**
- 正式群发的内容必须就是你刚刚预览过的那一版

否则一旦底层日报补数或刷新，预览内容和最终群发内容就可能漂移

## 内容结构

第一版统一采用 6 段结构：

### 1. 一句话总览

目标：

- 让所有店长 10 秒内理解昨天 5 店总盘

内容：

- 5 店总营收、总客流、总钟数
- 较上周同期的整体变化
- 当前最核心的判断词

例子：

- 5 店昨天总盘持平，客流未明显下滑，但后半程承接偏弱，主要差距集中在加钟和指定转化。

背景因子使用边界：

- 默认不单列“背景因子校准”章节
- 只有遇到春节、五一、十一、清明、端午、中秋、周末错位、极端天气、突发外部事件等强扰动日，才在总览里补一行背景校准
- 普通工作日样本不展开背景因子，避免把店内经营问题误解释成外部原因

### 2. 5 店量盘对比

目标：

- 解决“谁的盘子大、谁的盘子小”

核心字段：

- `serviceRevenue`
- `customerCount`
- `totalClockCount`

规则：

- 只看绝对量盘
- 不混入质量指标

### 3. 5 店质量对比

目标：

- 解决“谁承接得更好”

核心字段：

- `pointClockRate`
- `addClockRate`
- `clockEffect`

规则：

- 与量盘分开呈现
- 优先标记第一梯队、低于 5 店中位值、明显掉队门店

### 4. 上周同期变化

目标：

- 让店长看到“自己不是只跟别人比，也要跟自己比”

第一版建议固定用：

- 昨日 vs 上周同营业日

核心字段：

- `serviceRevenue`
- `customerCount`
- `pointClockRate`
- `addClockRate`

说明：

- 第一版不做更多复杂时间窗
- 只保留店长最容易理解的对比口径

### 5. 差距拆解

目标：

- 告诉店长差距到底发生在哪一段

第一版只输出 3 类高价值发现：

- 最值得复制的门店
- 最需要修复的门店
- 当前 5 店共性断点

输出风格不是抽象评价，而是结构化经营判断，例如：

- 客流不差，但点钟承接没吃满
- 点钟不弱，但加钟承接掉档
- 盘子不小，但钟效偏低
- 营收领先，但结构质量一般

### 6. 今日动作

目标：

- 让这份总览直接变成执行输入

动作分两层：

- 5 店共性动作：2-3 条
- 每店今日先抓：每店 1 条

这样所有店长既能看到全局，也能带走自己今天的第一动作。

## 指标选择

### 第一版核心指标

第一版只建议用当前最稳定、最可比的 6 个指标：

- `serviceRevenue`
- `customerCount`
- `totalClockCount`
- `pointClockRate`
- `addClockRate`
- `clockEffect`

理由：

- 这些指标都已经在单店日报和现有 query/runtime 路径中稳定存在
- 横向比较价值高
- 解释成本低

### 第二层可选指标

如果版面允许，再补：

- `newMembers`
- `rechargeCash`

但不建议让它们压过主 6 指标。

### 第一版暂不作为主指标

第一版不建议把以下内容放成主骨架：

- `预估到店人数`
- 各类实验中间指标
- 复杂会员长期指标

原因：

- 这份报表首先要解决“5 店昨天盘子和承接差距”
- 主结构应尽量建立在最稳定的日报事实之上

## 数据来源

第一版继续复用现有 truth source，不新建第二套真相层。

### 1. 昨日主数据

来源：

- `DailyStoreReport.metrics`
- 必要时回退 `StoreManagerDailyKpiRow`

核心依赖模块：

- `src/app/reporting-service.ts`
- `src/report.ts`
- `src/types.ts`

### 2. 上周同期对比

建议来源：

- 同一门店 `bizDate - 7` 的日报快照
- 或同一口径的 daily KPI row

原则：

- 只做同口径对比
- 不允许拿昨天整天去和半天、缺字段数据混比

### 3. 横向 benchmark

5 店 benchmark 第一版直接现场计算：

- 排名
- 中位值
- 第一梯队 / 掉队门店

不额外建物化层。

## 差距诊断规则

第一版不让 AI 决定主判断。

先做 deterministic gap diagnosis：

- 客流高于 5 店中位值，但加钟率低于中位值
  - 判断：客流不差，后半程转化偏弱
- 营收一般，但点钟率与钟效领先
  - 判断：质量不错，盘子还有放大空间
- 营收领先，但钟效偏低
  - 判断：量盘大，但结构效率不优
- 客流和总钟数都偏低
  - 判断：前端拉新或进店承接偏弱

### AI 的角色

第一版 AI 只允许做两件事：

1. 对 deterministic findings 做 bounded expression polishing
2. 生成更自然的“今日动作”描述草稿

AI 不允许：

- 自行发明差距成因
- 覆盖事实排序
- 绕过稳定指标链输出经营判断

## 与现有模块的关系

### 1. 与单店日报的关系

- 不替代单店日报
- 不把 5 店比较塞回单店日报正文

### 2. 与 5 店周报的关系

- 周报回答“这一周 5 店整体怎么走、下周怎么调”
- 本报回答“昨天 5 店横向差距在哪里、今天各店先抓什么”

### 3. 与 HQ 统一读链的关系

这份报表虽然是多店汇总，但仍是店长执行面，不应先做成 HQ diagnostic 面。

### 4. 与 midday brief 的关系

- midday brief 仍是单店版
- 本报是日报后的跨店共享版
- 两者不应混成一个 job

## 当前缺口与下一刀

如果继续推进，这条线最值得补的不是“再加更多文案”，而是把它从最小闭环补成可运营、可验收、可持续演进的能力。

### 第一优先级

- 增加 runtime / CLI 手动预览与确认发送入口，方便运营验收、问题重放和灰度联调
- 增加 admin / doctor 面向该 job 的读面摘要，至少能看到 `scheduled / waiting / sent / skipped / failed`
- 明确共享目标配置边界：如果未来店长共看群与 HQ 共享群分离，应支持独立 target，而不是长期复用一个 `sharedDelivery`

### 第二优先级

- 为差距拆解补更稳定的结构化 reason codes，避免未来 renderer 变复杂后难以复用
- 逐步补更贴店长执行面的辅助指标，但不能稀释当前主 6 指标骨架
- 在 deterministic findings 稳定后，再考虑 bounded AI expression polishing

### 当前不该优先做

- 不要把这份总览改造成 HQ 周报 lite
- 不要为了“更智能”而引入 AI 主判断链
- 不要先建新的 snapshot store / 横向总览真相层
- 不要把 external intelligence 直接混进昨日经营读面
- 不要把入口职责继续塞进 `src/runtime.ts`

## 实现边界

本轮明确不做：

1. 不做实时日内看板
2. 不做 AI-first portfolio diagnosis
3. 不新建第二套横向分析存储
4. 不把入口职责堆进 `src/runtime.ts`
5. 不把它写成 HQ 周报 lite

## 验收标准

这份设计落地后，至少应满足：

1. 5 家店长在看完单店日报后，能收到 1 份共享 5 店总览
2. 该总览能同时展示：
   - 横向量盘差距
   - 横向质量差距
   - 上周同期变化
   - 今日动作
3. 店长看完后，能明确知道：
   - 自己店在 5 店中的位置
   - 差距主要在哪个环节
   - 今天最先要抓什么
4. 第一版判断主链仍由 deterministic 指标驱动

## 设计结论

这份“5店昨日经营总览（店长共看版）”当前已经具备正确方向：

- 站位上，它是店长执行面共享读面，不是 HQ 诊断面
- 架构上，它走的是 `日报事实 -> reporting service -> shared delivery -> safe schedule waiting`
- 演进上，它下一步该补的是可运营能力与可观测能力，而不是先做更重的 AI 分析
