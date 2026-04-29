# Hetang Ops 排障手册

## 1. 目的

本文档用于处理当前项目最常见的 3 类问题：

- 企微里不回复
- 数据没同步全或日报不完整
- CrewAI 复盘卡住或输出不稳定
- HQ 外部情报质量差或不投递

---

## 2. 企微里 `/hetang` 不回复

### 2.1 先看通道状态

执行：

```bash
openclaw channels status --probe
```

目标状态：

- `wecom` 显示 `enabled`
- `configured`
- `running`

如果企微通道不是 `running`，先不要查业务数据，先恢复通道。

### 2.2 再看网关日志

常用：

```bash
tail -n 200 /tmp/openclaw-gateway.log
```

重点看：

- 插件是否加载失败
- 企微 websocket 是否断线
- inbound claim 是否命中
- 回复发送是否报错

### 2.3 再看权限绑定

执行：

```bash
pnpm openclaw hetang access list --channel wecom
```

若员工未绑定，会出现：

- `/hetang whoami` 返回“当前企微账号未绑定门店权限”

此时应先修权限，不要继续查数据。

### 2.4 再看配额

当前默认限额：

- 总部：`15` 次/小时，`80` 次/日
- 店长：`6` 次/小时，`30` 次/日

若超额，会被拒绝，但这属于“有响应的拒绝”，不是“完全不回复”。

---

## 3. 企微自然语言不触发

当前自然语言入口不是全量对话理解，而是“日报类查询路由”。

必须同时满足：

- 文本里包含门店名或别名
- 文本里包含 `营收 / 收入 / 营业额 / 日报 / 报表`
- 文本里包含 `今天 / 昨天 / YYYY-MM-DD`

群聊里还必须：

- `@` 机器人

例如可命中：

- `义乌店昨天营收`
- `华美店 2026-03-30 日报`

当前不会命中：

- `帮我分析一下义乌店为什么不行`
- `看下这家店`
- `昨天怎么样`

这不是故障，是当前能力边界。

---

## 4. `/hetang whoami` 能回，`/hetang report` 不行

优先检查 3 项：

### 4.1 是否跨店越权

多店权限店长若未明确指定门店，会收到：

- `当前账号已绑定多个门店，请先指定门店名或 OrgId`

### 4.2 是否门店名未识别

如果用了配置之外的门店名，会返回：

- `未识别门店，请使用配置中的标准门店名或 OrgId`

### 4.3 是否 API 凭证缺失

当前设计是：

- 缺 `api.appSecret` 不阻断数据库查询
- 但会阻断主动同步命令

如果是 `/hetang sync` 被拒绝，属于预期保护。

---

## 5. 数据已落库，但日报不完整

### 5.1 先看 `complete`

`mart_daily_store_reports.complete=false` 通常表示：

- 关键接口缺水位
- 当天同步不完整

### 5.2 再看端点水位

执行：

```bash
pnpm openclaw hetang doctor
```

若某店缺少任一接口 `1.1` - `1.8` 水位，该日可能被判定为 `incompleteSync`。

### 5.3 注意营业日口径

当前不是自然日，而是营业日：

- `05:00` 前的数据归前一营业日

所以如果拿自然日心智对比，会误以为数据“少一天”。

---

## 6. 某店回补是 `partial`

目前已知案例：

- `锦苑店` 最近一次回补为 `partial`
- 失败点：`endpoint 1.4`
- 记录内容：`fetch failed`

处理顺序：

1. 先单店复跑，不扩大到全店
2. 先单周复跑，不先跑全月
3. 观察 `sync_runs.details_json`
4. 若仍失败，再延后到更空闲的时段复跑

推荐动作：

```bash
pnpm openclaw hetang sync --org 627152677269509
```

若仍不稳，再跑周切片：

```bash
node --import tsx extensions/hetang-ops/scripts/backfill-and-rebuild.ts \
  --start 2026-03-22 \
  --end 2026-03-28 \
  --org 627152677269509
```

---

## 7. 日报已 build，但没发到企微

### 7.1 先看是否配置了通知目标

若门店没有启用的 `notification`，`sendReport()` 会直接失败。

### 7.2 再看发送回写

重点字段：

- `mart_daily_store_reports.sent_at`
- `mart_daily_store_reports.send_status`

若两者都为空，说明发送动作没有成功落地。

### 7.3 再看企微通道

若通道断线，build 成功也不会送达。

### 7.4 手工补发

```bash
pnpm openclaw hetang report --org 627150985244677 --date 2026-03-30 --send
```

---

## 8. HQ 外部情报没有产出

先确认 3 项：

### 8.1 功能是否启用

看配置里的：

- `externalIntelligence.enabled`
- `externalIntelligence.hqDelivery.channel`
- `externalIntelligence.hqDelivery.target`

若未启用，`/hetang intel latest` 只会返回空结果。

### 8.2 是否有有效源文档

优先检查：

- `external_source_documents`
- `external_event_candidates`

如果源文档为空，说明抓取或写入链路没进来，不要先查渲染层。

### 8.3 是否全部被规则挡掉

当前会被挡掉的常见原因：

- `blocked-course-promo`
- `blocked-soft-article`
- `blocked-stale`
- `blocked-missing-reliable-time`
- `needs-source-confirmation`

如果全是这些原因，说明当天源质量不够，不是组装逻辑故障。

---

## 9. HQ 外部情报质量差

### 9.1 先看是不是“搜索结果拼贴”

若最终输出里出现以下问题，说明上游源质量或规则需要调整：

- 标题像课程宣传
- 摘要不是完整中文段落
- 没有清晰时间
- 同一事件被重复写两次
- 热榜搬运进入最终 Top 列表

### 9.2 再看 source tier

当前规则：

- `s / a` 可直接进候选
- `b` 只能做 lead，需要更强源确认
- `blocked` 永不入选

若最终简报里 `b` 源过多，优先检查确认链是否缺失。

### 9.3 手工复核命令

```bash
/hetang intel latest
/hetang intel issue ext-brief-2026-04-03
/hetang intel sources
```

若 `sources` 本身配置混乱，先修源分层，不要直接调渲染文案。

---

## 10. CrewAI 复盘卡在模型调用阶段

### 10.1 先确认它读的是数据库，不是 API

当前 `CrewAI sidecar` 读取的是 PostgreSQL：

- `mart_daily_store_metrics`
- `mart_daily_store_alerts`
- `mart_daily_store_reports`
- 部分 `fact_*` 的 `raw_json`

所以同步链路正常但模型超时，不影响数据库本身。

### 10.2 优先用 `--print-context`

```bash
python store_review.py \
  --org 627150985244677 \
  --start 2026-03-24 \
  --end 2026-03-30 \
  --print-context
```

如果 context 能正常出，说明：

- 数据库读取正常
- 卡点在模型调用，不在数据侧

### 10.3 当前建议模式

优先使用：

- `CREWAI_REVIEW_MODE=direct`

原因：

- 更快
- 更稳定
- 更适合当前单店店长复盘

### 10.4 常见原因

- 模型网关响应慢
- 上下文过长
- 模型兼容参数不正确
- CrewAI 默认重试导致总超时拉长

---

## 9. 为什么“团购二次到店 / 团购后会员支付转化率”不是闭环会员归因

当前项目的安全表达是：

- `团购复到店率`
- `团购后会员支付转化率`

依赖的识别键是消费明细里的：

- `raw_json -> CCode`

要点：

- `CCode` 是当前可见的“客户代码”
- 它足够支持“同一消费客户在一段时间内是否再次消费、是否出现会员支付”的方向性分析
- 但它还不是已验证的“完整会员全链路唯一主键”

所以当前不应把它写成：

- 充值归因闭环
- 团购转储值闭环

正确说法仍应保持：

- `团购后会员支付转化率`

---

## 10. 为什么日报日期和门店营业感觉对不上

因为当前系统用的是营业日，不是自然日。

门店通常营业到次日凌晨，当前规则固定为：

- `05:00` 截止

例如：

- `2026-03-31 02:30` 发生的订单，记入 `2026-03-30`
- `2026-03-31 05:00` 之后，才算 `2026-03-31`

所以凌晨经营高峰店，必须按营业日解读数据。

---

## 11. 已知非阻断技术债

当前日志中仍可能出现：

```text
reqid-store warmup error: TypeError: (0 , _pluginSdk.readJsonFileWithFallback) is not a function
```

当前判断：

- 这不是 Hetang 数据链路主故障
- 但它说明还有额外插件面的兼容性问题待清理

处理优先级：

- 低于“企微不回”“日报不发”“数据不完整”
- 高于纯体验类优化

---

## 12. 排障优先顺序

遇到问题时，统一按这个顺序：

1. 通道是否活着
2. 权限是否通过
3. 数据是否落库
4. 日报是否生成
5. 企微是否成功发送
6. CrewAI 是否只是模型侧超时

不要一上来就怀疑 API，也不要先怀疑 PostgreSQL。
