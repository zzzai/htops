# Hetang Nightly Backfill Acceleration Design

## Context

当前 `03:00-04:00` 夜间任务仍然按旧的 `nightly-history-backfill/default` 游标，一周一周串行重放所有门店、所有历史端点。这个策略有两个根本问题：

1. 它把 `scheduled_job_state` 当成历史补齐真相源，但线上 PostgreSQL 的原始事实层已经远比该 state 更新。
2. 它把 API 时间窗口浪费在已经齐全的端点上，真正薄弱的端点和顾客派生层反而被拖慢。

已核实的现状是：

- `fact_consume_bills` / `fact_recharge_bills` / `fact_tech_up_clock` 五店基本都已覆盖到约半年。
- 顾客派生层主要缺口在 `fact_member_daily_snapshot`、`mart_customer_segments`、`mart_customer_conversion_cohorts`、`mv_customer_profile_90d`。
- `fact_user_trades` 仍是重端点，历史覆盖明显落后。

这说明最佳优化点不是“继续盲目并发”，而是“按真实覆盖缺口缩小 API 请求面”。

## Options

### Option A: 继续沿用周切片，只提高并发和缩短 sleep

- 优点：改动小。
- 缺点：会继续重放已齐窗口，API 时间仍主要浪费在无效请求上。
- 结论：不推荐。

### Option B: 只把切片从 7 天改大到 14-30 天

- 优点：吞吐会提升，尤其是对 `1.4` 这类按卡/按类型循环请求的端点。
- 缺点：如果不先识别覆盖缺口，只会更快地重复拉取已齐数据。
- 结论：单独使用不够。

### Option C: Coverage-aware raw backfill + local customer rebuild

- `03:00-04:00` 只跑仍有缺口的原始事实端点。
- 历史回补默认跳过 `1.1` / `1.5` / `1.8`，因为它们不是半年经营历史补齐的关键路径。
- 已经完整覆盖的 `1.2` / `1.3` / `1.6` 直接跳过。
- `04:05` 以后根据真实派生层覆盖，只对未追平的门店重建 `fact_member_daily_snapshot`、`mart_customer_segments`、`mart_customer_conversion_cohorts`、`mv_customer_profile_90d`。

- 优点：直接减少 API 请求量，最贴近当前数据状态，也是把 12 晚压到 2-3 晚的唯一现实路径。
- 缺点：需要新增 coverage helper 和计划器逻辑。
- 结论：推荐。

## Recommended Design

### 1. 原始事实覆盖成为 authoritative truth

新增 store coverage helper，直接按 PostgreSQL 里的实际表覆盖情况返回：

- 原始事实层：
  - `1.2 -> fact_consume_bills`
  - `1.3 -> fact_recharge_bills`
  - `1.4 -> fact_user_trades`
  - `1.6 -> fact_tech_up_clock`
  - `1.7 -> fact_tech_market`
- 顾客派生层：
  - `fact_member_daily_snapshot`
  - `mart_customer_segments`
  - `mart_customer_conversion_cohorts`
  - `mv_customer_profile_90d`

`scheduled_job_state` 不再决定“下一周从哪里开始”，只保留为调试/审计状态。

### 2. 03:00 任务改成 gap-driven planning

对每个门店，按覆盖情况生成一条 backfill plan：

- 先求每个端点是否已经跨越 `anchorStartBizDate..anchorEndBizDate`
- 仅把仍不完整的端点放进本轮 `requiredEndpoints`
- 历史 backfill 永远跳过：
  - `1.1` 会员当前快照
  - `1.5` 技师当前快照
  - `1.8` 提成配置快照
- 如果仅剩 `1.4` / `1.7` 这样的轻量或弱覆盖端点，则允许使用更大的 fast slice

### 3. 04:05 顾客补齐改成 local rebuild only when needed

顾客历史补齐不再“只看 job state 就整店 180 天全重建”，而是：

- 先看顾客派生层覆盖是否已经追平
- 已完整追平的门店直接跳过
- 未追平门店才做本地重建
- 本地重建只依赖：
  - `fact_consume_bills`
  - `fact_recharge_bills`
  - `fact_tech_up_clock`
  - `fact_member_current`
  - `fact_member_card_current`

也就是说，顾客层补齐不应继续阻塞在 `1.4 user_trades` 上。

## Expected Outcome

### 2-3 晚目标

通过下面三件事，半年补齐会显著提速：

1. 历史 backfill 默认跳过 `1.1` / `1.5` / `1.8`
2. 对已完整的 `1.2` / `1.3` / `1.6` 直接跳过
3. 顾客层不再等待 API，而是在本地基于已齐原始事实重建

### 1 晚目标

若要逼近“一晚完成”，在上述基础上还需要：

1. 对只剩 `1.4` / `1.7` 的门店启用 fast slice
2. 降低顶层 store/pass 间隔
3. 把 `1.4 user_trades` 明确降成低优先级补齐，不阻塞经营核心面

这里要明确：

- “一晚补齐核心经营面”是现实目标
- “一晚补齐全部辅助端点，尤其是 `1.4 user_trades`” 仍受供应商 API 吞吐上限约束

## Implementation Notes

- 先补测试，再改 runtime/store。
- 保留旧的 state-based backfill 作为 helper 不可用时的 fallback，避免回归风险。
- 新逻辑优先落在：
  - `extensions/hetang-ops/src/store.ts`
  - `extensions/hetang-ops/src/runtime.ts`
  - `extensions/hetang-ops/src/runtime.test.ts`
  - `extensions/hetang-ops/src/store.test.ts`
