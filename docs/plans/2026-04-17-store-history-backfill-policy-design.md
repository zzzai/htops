# Store History Backfill Policy Design

日期：2026-04-17
状态：approved
用途：把当前 5 家店的夜间历史补数策略收口成明确、可测试的门店级 policy。

## 背景

现有 `nightly-history-backfill` 已经是 coverage-aware，但仍然主要围绕统一窗口和“迎宾店近 30 天优先”的隐含逻辑工作。

这和当前业务要求不完全一致：

- 迎宾店：继续尽量向上游 API 可提供的最早日期补齐
- 其余 4 店：只要求从 `2025-10-06` 起保持历史完整；补齐后每日只做增量

如果不把这条规则收成门店级策略，planner 会继续在“统一窗口”和“门店例外”之间漂移。

## 目标

1. 把 5 店 backfill 规则收成一处 owner policy
2. 让 coverage-aware planner 直接消费该 policy
3. 保持改动集中在 `src/app/sync-service.ts` 和测试
4. 不把更多职责塞进 `src/runtime.ts`

## 非目标

1. 不扩 scheduler / control-plane contract
2. 不改 query/report 主链
3. 不修改数据库 schema
4. 不把 store policy 做成新的配置面

## 方案

### 方案 A：在 `sync-service.ts` 内新增门店级 backfill policy resolver

实现一个很小的 owner helper，根据门店名返回当前项目认可的补数窗口策略：

- `荷塘悦色迎宾店`
  - full-history start: `2018-12-02`
  - 仍保留“近 30 天优先，再回全历史窗口”的 planner 行为
- `荷塘悦色义乌店 / 华美店 / 锦苑店 / 园中园店`
  - shared floor start: `2025-10-06`
  - 直接按 `max(globalStart, 2025-10-06)..end` 做 coverage-aware 规划
- 其他未知门店
  - 保持现有 legacy planner 行为，避免扩大兼容面

推荐这个方案。原因：

- 改动最小
- 行为最贴近当前真实业务约束
- 不引入新的配置面和控制面语义

### 方案 B：把 policy 升成 config

优点：

- 长期更规范
- 新增门店时更容易维护

缺点：

- 这轮会扩 `types/config/tests`
- 改动面明显大于本次需求

本轮不选。

## 运行效果

### 4 店

- 如果 `2025-10-06` 以来的数据已完整，nightly backfill 不再继续追更早历史
- 如果 `2025-10-06` 以来存在缺口，则继续按 coverage gap 修补

### 迎宾店

- 仍优先修近 30 天缺口
- 若近 30 天已齐，则继续回到更早历史窗口补 raw facts

## 测试策略

至少新增两类回归测试：

1. 非迎宾店会把 planner 起点钉在 `2025-10-06`
2. 迎宾店在近 30 天已齐时，会回退到全历史窗口继续补数

## 风险与控制

### 风险 1：迎宾店更早窗口让 `1.6/1.7` 长期被视作缺口

控制：

- 现有 coverage helper 已支持“重复零行窗口 -> provisional coverage”
- 本次不改这条语义

### 风险 2：未知测试门店行为被一刀切改变

控制：

- 只对当前 5 家店显式套用新 policy
- 未识别门店保留 legacy 行为

## 落地点

- 修改：`src/app/sync-service.ts`
- 新增/更新测试：`src/app/sync-service.test.ts`
- 验证：`src/app/sync-service.test.ts`、`src/runtime.test.ts`
