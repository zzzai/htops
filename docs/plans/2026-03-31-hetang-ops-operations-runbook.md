# Hetang Ops 运行手册

## 1. 目的

本文档面向当前 `企微 + OpenClaw + hetang-ops + PostgreSQL + CrewAI sidecar` 项目的日常运维，目标是把“如何看健康、如何跑任务、如何回补、如何重算、如何确认发送状态”写成一份可直接执行的手册。

适用范围只覆盖当前首版目标：

- `5` 家门店稳定出数
- 按 `org_id` 归属
- 日报进企微
- 店长可在企微安全查询自己门店的日报类数据
- 总部可获取 HQ 外部情报简报

---

## 2. 当前运行基线

截至 `2026-03-31`，数据库中的 5 店覆盖情况如下：

| 门店             | OrgId             | mart 日指标                       | mart 日报     | 消费事实                          | 技师上钟事实                      | 最近同步状态 |
| ---------------- | ----------------- | --------------------------------- | ------------- | --------------------------------- | --------------------------------- | ------------ |
| 荷塘悦色义乌店   | `627150985244677` | `31` 天，`2026-03-01..2026-03-31` | `31` 天，完整 | `30` 天，`2026-03-01..2026-03-30` | `30` 天，`2026-03-01..2026-03-30` | `success`    |
| 荷塘悦色华美店   | `627152412155909` | `31` 天，`2026-03-01..2026-03-31` | `31` 天，完整 | `31` 天，`2026-03-01..2026-03-31` | `31` 天，`2026-03-01..2026-03-31` | `success`    |
| 荷塘悦色园中园店 | `627153074147333` | `31` 天，`2026-03-01..2026-03-31` | `31` 天，完整 | `30` 天，`2026-03-01..2026-03-30` | `31` 天，`2026-03-01..2026-03-31` | `success`    |
| 荷塘悦色迎宾店   | `627149864218629` | `31` 天，`2026-03-01..2026-03-31` | `31` 天，完整 | `31` 天，`2026-02-28..2026-03-30` | `30` 天，`2026-03-01..2026-03-30` | `success`    |
| 荷塘悦色锦苑店   | `627152677269509` | `31` 天，`2026-03-01..2026-03-31` | `31` 天，完整 | `32` 天，`2026-01-09..2026-03-31` | `31` 天，`2026-03-01..2026-03-31` | `partial`    |

补充说明：

- 5 家店的 `mart_daily_store_metrics` 和 `mart_daily_store_reports` 已基本覆盖整个 `2026-03`。
- 当前样本里 `mart_daily_store_reports.send_status` 仍以空值为主，说明“日报已生成”不等于“日报已实际发送到企微”。
- `锦苑店` 最近一次回补存在 `1.4 fetch failed`，需要在后续低压时段单店复跑确认。

---

## 3. 运行时序

当前系统有两类运行方式：

### 3.1 自动定时

当前插件默认配置：

- 同步窗口：`03:00` - `05:00`
- 增量同步：`03:10`
- 日报生成：`08:50`
- HQ 外部情报生成：`08:50`
- 日报发送：`09:00`
- 营业日截止：`05:00`

这意味着：

- `00:00` - `04:59` 的业务，归到前一个 `biz_date`
- `05:00` 后进入新的营业日
- 早上 `09:00` 推送的是“最近一个已完成营业日”的日报

### 3.2 人工慢速任务

人工回补允许在 API 低压窗口执行。当前运营建议：

- 优先时段：`03:00` - `18:00`
- 避开高压时段：`20:00` - 次日 `02:00`
- 回补粒度：按周切片
- 节奏原则：慢、稳、可重试，不暴力刷取

---

## 4. 核心命令

以下命令均在仓库根目录执行。

### 4.1 健康检查

```bash
pnpm openclaw hetang doctor
```

用途：

- 检查数据库是否可连
- 检查 5 店是否都在配置中
- 检查 API 凭证是否已配置
- 查看每店 8 个接口的最新水位

### 4.2 立即执行到期任务

```bash
pnpm openclaw hetang run-due
```

用途：

- 手动触发“当前时间已经到点但尚未执行”的同步 / 报表 / HQ 外部情报 / 发送任务

### 4.3 单店增量同步

```bash
pnpm openclaw hetang sync --org 627150985244677
```

用途：

- 对单店补跑一次增量
- 适合处理某店当日异常或企微店长催数

### 4.4 单店重建日报

```bash
pnpm openclaw hetang report --org 627150985244677 --date 2026-03-30
```

用途：

- 只重算，不发送

### 4.5 单店重建并发送日报

```bash
pnpm openclaw hetang report --org 627150985244677 --date 2026-03-30 --send
```

用途：

- 先重算，再发送
- 发送成功后会回写 `mart_daily_store_reports.sent_at` 和 `send_status`

### 4.6 慢速回补并重建日报

```bash
node --import tsx extensions/hetang-ops/scripts/backfill-and-rebuild.ts \
  --start 2026-03-01 \
  --end 2026-03-31 \
  --org 627150985244677
```

当前脚本行为：

- 按 `7` 天一个切片执行
- 店与店之间默认间隔 `20s`
- 周切片之间默认间隔 `30s`
- 回补阶段会跳过快照类接口 `1.1 / 1.5 / 1.8`
- 回补完成后，逐日重建指定区间的日报

### 4.7 权限清单查看

```bash
pnpm openclaw hetang access list --channel wecom
```

### 4.8 批量导入权限

```bash
pnpm openclaw hetang access import --channel wecom --file <json-file>
```

### 4.9 CrewAI 单店复盘

```bash
cd tools/crewai-sidecar
source .venv/bin/activate
python store_review.py \
  --org 627150985244677 \
  --start 2026-03-24 \
  --end 2026-03-30
```

### 4.10 HQ 外部情报命令

```bash
/hetang intel run
/hetang intel latest
/hetang intel issue ext-brief-2026-04-03
/hetang intel sources
```

用途：

- `intel run` 立即重建一份 HQ 外部情报简报并在当前会话返回
- `intel latest` 查看最近一次已落库的简报
- `intel issue` 查看指定期次
- `intel sources` 检查当前外部情报源分层配置

---

## 5. 每日运维检查清单

### 5.1 凌晨同步后

执行：

```bash
pnpm openclaw hetang doctor
```

确认：

- 5 店都有 `1.1` - `1.8` 水位
- 最近一次 `sync_runs` 没有异常堆积
- 没有某店水位明显落后其他门店

### 5.2 日报生成后

重点看：

- `mart_daily_store_reports.complete` 是否为 `true`
- `markdown` 是否为空
- 是否有异常告警被写入

### 5.3 日报发送后

重点看：

- `sent_at` 是否落库
- `send_status` 是否为 `sent` 或 `alert-only`
- 若为空，优先排查通知目标配置和企微通道

### 5.4 HQ 外部情报生成后

重点看：

- 是否生成 `ext-brief-YYYY-MM-DD` 期次
- `外部情报` 内容是否是事件级，不是搜索结果拼贴
- 是否存在软文、旧闻翻炒、无可靠时间的信息混入
- 总部投递目标是否收到完整中文段落版简报

---

## 6. 推荐 SQL / 查询视角

当前宿主机未安装 `psql`，建议通过 Node `pg` 脚本或容器内执行 SQL。

重点表：

- `dim_store`
- `sync_runs`
- `endpoint_watermarks`
- `fact_consume_bills`
- `fact_user_trades`
- `fact_tech_up_clock`
- `fact_tech_market`
- `mart_daily_store_metrics`
- `mart_daily_store_reports`
- `employee_bindings`
- `employee_binding_scopes`
- `command_audits`
- `external_source_documents`
- `external_event_candidates`
- `external_event_cards`
- `external_brief_issues`
- `external_brief_items`

运维观察优先级：

1. 先看 `sync_runs`
2. 再看 `endpoint_watermarks`
3. 再看 `mart_daily_store_reports`
4. 最后才下钻 `fact_*`

外部情报排查优先级：

1. 先看 `external_source_documents`
2. 再看 `external_event_candidates`
3. 再看 `external_event_cards`
4. 最后看 `external_brief_issues` / `external_brief_items`

---

## 7. 回补操作规范

### 7.1 March 回补的标准动作

当前推荐顺序：

1. 先确认营业日口径已经生效
2. 再按周切片回补 `2026-03`
3. 回补完成后重建 `2026-03` 的日报 / 月内日报
4. 最后再给店长看分析结果

### 7.2 周切片建议

推荐切片：

- `2026-03-01..2026-03-07`
- `2026-03-08..2026-03-14`
- `2026-03-15..2026-03-21`
- `2026-03-22..2026-03-28`
- `2026-03-29..2026-03-31`

### 7.3 遇到单店异常时

不要直接重跑全 5 店全月，优先：

1. 先单店
2. 再单周
3. 再看具体失败接口
4. 最后才扩大范围

---

## 8. 发送链路说明

日报发送链路是：

`mart_daily_store_reports -> sendReport() -> OpenClaw channel -> WeCom target`

关键前提：

- 门店配置里必须有启用状态的 `notification`
- OpenClaw 企微通道必须处于 `running`
- 对应企微 Bot / target 可用

当前项目常见误区：

- “日报能 build” 不代表 “日报一定能 send”
- `complete=true` 只代表当时按口径能生成，不代表企微发送成功

---

## 9. 已知运行风险

### 9.1 已记录风险

- `锦苑店` 最近一次回补出现 `1.4 fetch failed`
- 企微发送状态仍未形成稳定的日常落库闭环
- 日报查询已可用，但“任意自然语言深度经营分析”还未接到企微主链路

### 9.2 已知非阻断告警

网关日志中仍可能出现：

```text
reqid-store warmup error: TypeError: (0 , _pluginSdk.readJsonFileWithFallback) is not a function
```

当前判断：

- 这不是 Hetang 主链路阻断项
- 企微长连接与日报查询仍可工作
- 但它仍应作为后续技术债排查项保留

---

## 10. 当班交接建议

交接时至少同步 4 件事：

1. 当天哪几家店已经完成同步
2. 哪几家店日报已发送，哪几家只 build 未 send
3. 是否存在单店单接口 `partial`
4. 是否有人工回补任务正在跑，以及当前跑到哪一个周切片

---

## 11. Phase 1b 生产采样与灰度验证

这一节只服务一件事：

- 给 `semantic routing` 切默认前，先把真实提问、路由准确率、`P50/P95 latency` 采出来

### 11.1 导出真实入站提问样本

先用入站审计导出最近一批真实企微提问：

```bash
pnpm openclaw hetang inbound-audit \
  --channel wecom \
  --limit 200 \
  --json > /tmp/hetang-inbound-audit-latest.json
```

如果要聚焦某一类问题：

```bash
pnpm openclaw hetang inbound-audit \
  --channel wecom \
  --contains 画像 \
  --limit 100 \
  --json > /tmp/hetang-inbound-audit-profile.json
```

执行要求：

- 从导出的 JSON 里人工去重，优先保留 `50` - `100` 条真实高频问法
- 不要只挑错例，也要覆盖真实高频正常问法
- 至少覆盖：
  - 单店指标问法
  - 五店排名 / 盘子问法
  - 顾客画像 / 跟进名单问法
  - 技师画像 / 技师排名问法
  - 经营复盘 / 深度分析问法
  - clarification / unsupported / guidance 问法

### 11.1.1 从入站审计快速生成 draft eval fixtures

如果需要先快速得到一份“可人工校对”的 draft fixture，可以直接用脚本把入站审计转成语义路由样本：

```bash
pnpm exec tsx scripts/build-route-eval-fixtures.ts \
  --input /tmp/hetang-inbound-audit-latest.json \
  > /tmp/hetang-route-eval-draft.json
```

如果要显式指定配置文件：

```bash
pnpm exec tsx scripts/build-route-eval-fixtures.ts \
  --input /tmp/hetang-inbound-audit-latest.json \
  --config /root/htops/htops.json \
  > /tmp/hetang-route-eval-draft.json
```

说明：

- 默认会走 standalone 配置加载：`htops.json + .env.runtime`
- 输出结果是 draft，不是最终真值；必须人工复核 `expectedLane / expectedIntentKind / expectedCapabilityId`
- 建议先保留脚本自动猜测，再人工修正高频 / 高风险样本，最后沉淀进正式 eval set

### 11.2 统计 shadow route accuracy 与延迟

从 bridge 服务日志汇总路由对比：

```bash
pnpm exec tsx scripts/summarize-route-compare.ts \
  --service htops-bridge.service \
  --since "2026-04-15 00:00:00" \
  --json > /tmp/hetang-route-compare-2026-04-15.json
```

看可读摘要：

```bash
pnpm exec tsx scripts/summarize-route-compare.ts \
  --service htops-bridge.service \
  --since "2026-04-15 00:00:00"
```

当前摘要口径已经直接给出：

- `route_match`
- `route_diff`
- `route_accuracy_pct`
- `capability_diff`
- `capability_accuracy_pct`
- `latency_p50_ms`
- `latency_p95_ms`
- `front_door_decisions`
- `top_route_diffs`

### 11.3 如何判读这份摘要

重点先看 4 项：

1. `route_accuracy_pct`
   - 这是 semantic 路由和 legacy 路由的一致率
2. `capability_accuracy_pct`
   - 这是 capability 选择的一致率
3. `latency_p50_ms` / `latency_p95_ms`
   - 这是 bridge 入口到回复就绪的真实延迟基线
4. `top_route_diffs`
   - 这是最该优先修的误路由类型

优先级原则：

1. 先修高频 diff
2. 再修高风险 diff
3. 最后才追求长尾完美

### 11.4 灰度上线前的最低门槛

在把 `routing.mode=semantic` 设为默认前，至少满足：

- 已拿到一份真实 `eval set`
- `route_accuracy_pct` 稳定可解释
- `capability_accuracy_pct` 没有明显倒退
- `latency_p50_ms / latency_p95_ms` 没有明显恶化
- `top_route_diffs` 里没有高频高风险错分

### 11.5 切换与回滚

查看当前模式：

```bash
pnpm openclaw hetang routing-mode
```

切到 shadow：

```bash
pnpm openclaw hetang routing-mode shadow
```

切到 semantic：

```bash
pnpm openclaw hetang routing-mode semantic
```

如果灰度期发现 route diff 或 reply quality 异常，立即回滚：

```bash
pnpm openclaw hetang routing-mode legacy
```
