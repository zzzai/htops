# Hetang Nightly API Depth Probe Design

## Goal

在每天 `03:00-04:00` 的夜间同步窗口内，顺手做一个轻量 API 历史深度探针，只回答一个问题：

“当前 API 至少还能取到多早的数据窗口？”

## Scope

本次只做最小实现：

1. 探针挂到现有 `sync` 定时任务尾部
2. 只打 API，不写正式事实表
3. 把结果写到 `scheduled_job_state`
4. 在当次任务日志里输出一行摘要

## Chosen Approach

### Probe timing

在 `syncStores()` 和 `runNightlyHistoryBackfill()` 之后运行。这样主同步和主补数优先，探针只“顺手”执行。

### Probe target

默认只用第一家有效门店作为代表门店，降低请求量；当前也就是迎宾店。

### Probe endpoints

只探有明确历史窗口意义的接口：

- `1.1`
- `1.2`
- `1.3`
- `1.6`
- `1.7`

特殊说明：

- `1.4` 是会员卡粒度接口，标记为 `card-scoped`
- `1.5`、`1.8` 是当前态接口，标记为 `current-only`

### Probe method

每个接口只测一组固定 lookback 档位，从老到新尝试：

- `540d`
- `365d`
- `270d`
- `180d`
- `90d`
- `30d`

每次只取一个 7 天窗口。找到第一个有数据的窗口后立刻停止，该窗口起点视为“当前已确认的最深历史”。

### Persistence

写入 `scheduled_job_state`：

- `job_type = nightly-api-depth-probe`
- `state_key = latest`

保存：

- `probedAt`
- `orgId`
- `storeName`
- `anchorBizDate`
- 每个接口的结果、命中的最深窗口、错误或跳过原因

## Why This Approach

相比做完整二分或月度全扫描，这个版本：

1. 请求量更小
2. 更不影响主同步
3. 已经足够回答“API 现在至少能回到多久以前”

## Testing

1. `runDueJobs()` 在 `sync` job 后会执行探针，并追加一行摘要
2. 探针结果会写入 `scheduled_job_state`
3. 当窗口不足或无可用门店时，探针应跳过而不报错
