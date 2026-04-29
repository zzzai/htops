# Control Plane Production Acceptance Checklist

日期：2026-04-16
状态：active
用途：固化 `scheduler / doctor / queue / query observability` 的生产验收顺序，避免值班时重复靠记忆判断。

---

## 1. 适用范围

本清单用于以下场景：

- scheduled worker 重启后验收
- control plane 相关改动上线后验收
- 日报发送/补发链路核对
- analysis backlog 与 dead-letter 解释
- query lane 路由/延迟基线采样

本清单不用于：

- 全量历史补数回放
- 单次业务数据修复
- AI 分析质量评测

---

## 2. 验收顺序

### 2.1 先看 worker 是否持续运行

```bash
tail -n 120 /tmp/hetang-scheduled-worker.log
```

期望：

- 持续看到 `scheduled-sync poller ok`
- 如 delivery 有 due 工作，应看到 `scheduled-delivery`
- 没有持续重复的同类报错

说明：

- `scheduled-sync` 持续刷新代表 sync lane 在跑
- `scheduled-delivery` 结果为 `0` 可以是正常现象，表示当前无待投递任务

### 2.2 再看 doctor 的 authoritative 解释

```bash
node --import tsx src/main.ts hetang doctor
```

重点行：

- `Scheduler: app service pollers authoritative`
- `Poller scheduled-sync`
- `Poller scheduled-delivery`
- `Poller analysis`
- `Scheduler job: 顾客历史补齐(run-customer-history-catchup) ... role=conditional`
- `Report delivery upgrades (7d)`
- `Analysis dead letters`

解释规则：

- `run-customer-history-catchup` 为 `role=conditional`
  - 这是条件性派生补齐任务
  - `pending` 不等于主链故障
- `nightly-history-backfill` 才是夜间统一历史补数主链的一部分
- `Analysis dead letters ... stale=yes`
  - 更偏向历史残留
  - 不代表当前仍在持续新增故障

### 2.3 再看 Query API 是否和 doctor 对齐

```bash
curl -sf http://127.0.0.1:18890/api/v1/runtime/scheduler | jq '.'
curl -sf http://127.0.0.1:18890/api/v1/runtime/queues | jq '.'
```

重点字段：

- `/runtime/scheduler.entry_surface`
- `/runtime/scheduler.observability_streams`
- `/runtime/scheduler.contract_version`
- `/runtime/scheduler.jobs[].surface_role`
- `/runtime/scheduler.jobs[].surface_note`
- `/runtime/queues.entry_surface`
- `/runtime/queues.observability_streams`
- `/runtime/queues.analysis.dead_letter_summary.latest_unresolved_age_hours`
- `/runtime/queues.analysis.dead_letter_summary.stale`
- `/runtime/queues.analysis.dead_letter_summary.residual_class`

期望：

- Query API 明确声明自己是 `read_only` 的 runtime query surface
- scheduler / doctor 使用同一份 contract 语义
- analysis dead-letter 摘要能直接区分“当前故障”与“历史积压”
- 若出现 `residual_class = stale-invalid-chatid-subscriber`
  - 代表当前更多是历史坏订阅残留
  - 不应误判为 analysis delivery 正在持续扩散

### 2.4 再核对日报发送事实

```bash
bash -lc 'set -a && source /root/htops/.env.runtime >/dev/null 2>&1 || true && psql "${HETANG_QUERY_DATABASE_URL:-${QUERY_DATABASE_URL:-${DATABASE_URL:-${HETANG_DATABASE_URL:-}}}}" -At -F $'\''\t'\'' -c "select store_name, biz_date, complete, send_status, sent_at from mart_daily_store_reports order by biz_date desc, store_name asc limit 10;"'

bash -lc 'set -a && source /root/htops/.env.runtime >/dev/null 2>&1 || true && psql "${HETANG_QUERY_DATABASE_URL:-${QUERY_DATABASE_URL:-${DATABASE_URL:-${HETANG_DATABASE_URL:-}}}}" -At -F $'\''\t'\'' -c "select send_status, count(*) from mart_daily_store_reports where biz_date >= to_char(current_date - interval '\''3 day'\'', '\''YYYY-MM-DD'\'') group by send_status order by send_status;"'
```

期望：

- 最新日报行为以 `send_status=sent` 为主
- 没有新增 `alert-only` 残留

补充核对 upgrade telemetry：

```bash
bash -lc 'set -a && source /root/htops/.env.runtime >/dev/null 2>&1 || true && psql "${HETANG_QUERY_DATABASE_URL:-${QUERY_DATABASE_URL:-${DATABASE_URL:-${HETANG_DATABASE_URL:-}}}}" -At -F $'\''\t'\'' -c "select store_name, biz_date, alert_sent_at, upgraded_at from mart_daily_report_delivery_upgrades order by upgraded_at desc limit 10;"'
```

说明：

- 最近为空是允许的
- 空表示“近期没有发生 upgrade”，不表示 telemetry 无效

### 2.5 最后看 query / semantic 观测

桥接路由摘要：

```bash
node --import tsx scripts/summarize-route-compare.ts --service htops-bridge.service --since "today"
```

Hermes frontdoor 摘要：

```bash
node --import tsx scripts/summarize-hermes-frontdoor.ts --service hermes-gateway.service --since "today"
```

重点看：

- `route_accuracy_pct`
- `capability_accuracy_pct`
- `clarification_needed`
- `latency_p50_ms`
- `latency_p95_ms`
- `selected_lanes`
- `selected_capabilities`
- `slow_samples`

### 2.6 上线后再看 deploy-window 语义质量

当本轮改动涉及：

- semantic intent
- capability graph
- analysis lens
- doctor / runtime semantic quality 读面

不要只看 24 小时聚合，必须再看一次部署后窗口。

建议先记下本轮服务重启完成时间，作为 `DEPLOY_ISO`：

```bash
systemctl status --no-pager --lines=8 htops-query-api.service
systemctl status --no-pager --lines=8 htops-bridge.service
```

然后查 deploy-window：

```bash
curl -sf "http://127.0.0.1:18890/api/v1/runtime/semantic-quality?occurred_after=<DEPLOY_ISO>" | jq '.'
```

重点字段：

- `effective_occurred_after`
- `total_count`
- `top_failure_classes`
- `optimization_backlog`
- `sample_candidates`

解释规则：

- `total_count = 0`
  - 代表部署后窗口内暂未出现新的语义失败样本
- `top_failure_classes` 为空，但 24 小时聚合仍有值
  - 说明更多是旧窗口历史样本，不要误判为“新代码还在继续出错”
- deploy-window 内如果仍出现：
  - `entry_unresolved`
  - `generic_unmatched`
  - `semantic_failure`
  - 应优先按 `optimization_backlog.owner_module` 回到对应 owner module 修复

说明：

- `doctor` 继续用于值班总览
- `runtime/semantic-quality?occurred_after=...` 用于上线后净窗口判断
- 这两者回答的是不同问题，不要混用

---

## 3. 常见判断误区

### 3.1 `scheduled poller lastRun` 偏旧

先不要直接判为异常。

优先判断：

1. 当前长轮次是否尚未结束
2. worker 日志是否仍在持续刷新
3. split poller 是否都还能继续写新 outcome

只有在日志停滞、worker 正常但 poller 长时间不刷新时，才怀疑回写缺口。

### 3.2 `run-customer-history-catchup` 处于 pending

这不自动等于异常。

它是条件性任务，依赖夜间原始事实覆盖和派生层修复条件。

### 3.3 `Analysis dead letters` 不为 0

先看：

- `latest_unresolved_age_hours`
- `stale`
- `latest_reason`
- `residual_class`

如果 `stale=yes` 且时间已明显陈旧，更像历史残留，不要误判为当前扩散中的故障。

如果同时看到：

- `latest_reason = invalid chatid`
- `residual_class = stale-invalid-chatid-subscriber`

优先解释为：

- 历史无效 chatid 订阅残留
- 伴随 subscriber fan-out exhaustion 的派生 job dead letters
- 当前重点应是清理坏订阅或忽略历史噪音，而不是怀疑主链 analysis worker

---

## 4. 收口标准

一次 control plane 改动可以认为验收通过，当且仅当：

1. worker 日志持续刷新
2. doctor 与 `/runtime/scheduler` 解释一致
3. `/runtime/queues` 能区分当前问题与历史积压
4. 最新日报 `send_status` 没有异常回退
5. query observability 能给出 lane / capability / latency 基线

如果本轮涉及语义识别或语义质量读面，额外要求：

6. deploy-window 内 `entry_unresolved / generic_unmatched / semantic_failure` 没有新增样本
7. deploy-window 若无新增失败，则优先宣布“新窗口稳定”，不要继续被旧 24 小时聚合牵着走
