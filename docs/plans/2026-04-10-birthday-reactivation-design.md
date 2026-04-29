# Birthday Reactivation Integration Design

## Goal

把“生日会员名单”并入现有召回执行层，而不是继续作为一条独立排序逻辑存在。目标是让迎宾店后续所有“生日关怀 / 生日召回 / 高价值生日名单”都优先复用 `mart_member_reactivation_queue_daily` 的优先级、分层和解释文案。

## Current Context

- 当前召回执行层已经有日队列表 `mart_member_reactivation_queue_daily`
- 当前生日查询直接从 `fact_member_current.raw_json.Birthday` 解析生日
- 当前生日名单排序仍是临时规则，和召回优先级没有统一
- 当前核心诉求不是全面重构会员主数据，而是先把生日信号接进可执行召回模型

## Options

### Option A: 只在生日查询里读现有召回队列做排序

- 优点：改动最小
- 缺点：生日不会影响召回优先级，只是展示层排序变了

### Option B: 在召回队列里加入生日信号，并让生日查询复用队列排序

- 优点：生日真正进入召回模型；名单、排序、理由统一；后续触达任务也能直接复用
- 缺点：需要补队列表字段、重建逻辑和少量测试

### Option C: 先把生日字段全面规范化进所有会员事实表和宽表

- 优点：长期最干净
- 缺点：当前投入过大，不适合这次“一次性补齐可用能力”的目标

## Recommendation

选择 Option B。

这是当前投入最小、业务价值最高的方案：生日不再只是“查名单”，而是变成召回优先级的一部分，同时又不引入一次重的主数据改造。

## Data Model Changes

在 `mart_member_reactivation_queue_daily` 增加以下字段：

- `execution_priority_score`
- `birthday_month_day`
- `next_birthday_biz_date`
- `birthday_window_days`
- `birthday_boost_score`

说明：

- `strategy_priority_score` 保留为原始召回策略分
- `execution_priority_score` 作为最终执行排序分，等于原策略分加生日加权
- `birthday_month_day` 用于任意时间窗生日匹配
- `next_birthday_biz_date` / `birthday_window_days` 用于当前营业日视角下的“近期生日”判断

## Birthday Signal Rules

- 生日仍从会员原始 `raw_json.Birthday` 解析，不新增上游依赖
- 队列重建时，优先读取 `fact_member_daily_snapshot` 当天会员快照的生日
- 若生日可解析，则计算从 `biz_date` 起最近一次生日日期
- 只有未来 7 天内的生日才给召回模型加权
- 加权为“温和增强”，不能压过核心召回信号

建议加权：

- 当天生日：最高加权
- 1-3 天内生日：中高加权
- 4-7 天内生日：轻量加权
- 高价值待唤回 / 高价值稳态会员可额外上浮一点

## Queue Rebuild Flow

1. 读取 `mart_member_reactivation_features_daily`
2. 读取 `mart_member_reactivation_strategies_daily`
3. 读取同日期范围的 `fact_member_daily_snapshot`
4. 为每个 `org_id + biz_date + member_id` 解析生日并计算生日信号
5. 生成最终 `execution_priority_score`
6. 按最终执行分重排 `priority_rank / priority_band`
7. 把生日信息和执行分写回 `mart_member_reactivation_queue_daily`

## Query Behavior

生日相关问题改成两层逻辑：

### 第一层：先命中生日窗口

- 根据问题时间窗匹配 `birthday_month_day`
- 继续保留“高价值”“最近90天没来店”“沉默待唤回”等过滤条件

### 第二层：优先按召回队列排序

- 若存在对应日队列，则按 `priority_rank` / `execution_priority_score` 排序
- 若没有队列，则退回当前基于余额和沉默天数的旧排序逻辑

这样可以支持：

- 今天过生日的高价值会员
- 未来 7 天最值得先跟进的生日会员
- 最近 90 天没来店的生日会员

## Output Changes

生日名单在有召回队列时，输出中补充：

- `P0/P1/P2/P3`
- 生日日期
- 当前经营标签
- 召回理由摘要

保持原来的储值、沉默天数、最近到店时间，避免业务方阅读成本突增。

## Error Handling

- 没有 `Birthday`：仅不参与生日信号，不影响基础召回
- 没有队列快照：生日查询退回原有逻辑
- 生日格式脏数据：静默跳过，不阻塞整批队列重建

## Testing

需要新增或扩展三类测试：

- 队列构建测试：验证生日加权会影响最终执行排序，但不会破坏基本 band 逻辑
- 存储层测试：验证新增生日字段可持久化
- 查询测试：验证生日名单优先复用召回队列排序，且无队列时仍能正常回退
