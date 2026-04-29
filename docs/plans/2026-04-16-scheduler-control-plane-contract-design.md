# Scheduler Control Plane Contract Design

日期：2026-04-16
状态：approved
用途：收口 scheduler catalog 与 poller 命名契约，消除 TypeScript worker 面与 Python Query API 面的重复定义和歧义状态。

---

## 1. 问题

当前控制面有两个明确问题：

1. scheduler catalog 在 `src/schedule.ts` 与 `api/main.py` 各维护一份静态定义，已经发生漂移
2. worker 已拆为 sync lane / delivery lane，但 poller 状态仍聚合为单一 `scheduled`

这会让 doctor、Query API、日志和实际 worker 行为之间出现解释偏差。

---

## 2. 目标

本次只做最小控制面收口，不做目录迁移和 runtime 大改。

目标：

1. 为 scheduler catalog 提供唯一静态真相源
2. 把 poller 标准命名定为：
   - `scheduled-sync`
   - `scheduled-delivery`
   - `analysis`
3. 让 TypeScript doctor 面与 Python Query API 面按同一契约输出

---

## 3. 方案

引入一份仓库内共享的静态 control-plane contract 文件，至少包含：

- scheduler catalog
- authoritative poller names

使用方式：

- `src/schedule.ts` 读取它作为 scheduler catalog 静态元数据来源
- `src/app/admin-read-service.ts` 读取它作为 authoritative poller 列表来源
- `api/main.py` 读取同一份文件构造 scheduler snapshot

---

## 4. 边界

本次不做：

- 修改 job due 计算规则
- 修改 run key 规则
- 修改 queue 结构
- 把 scheduler 状态迁出 PostgreSQL

---

## 5. 改动面

- `src/schedule.ts`
- `src/service.ts`
- `src/app/admin-read-service.ts`
- `src/types.ts`
- `src/ops/doctor.ts`
- `api/main.py`
- 对应测试

允许新增一份很薄的共享控制面契约文件。

---

## 6. 验证

先跑聚焦测试：

```bash
npx vitest run src/schedule.test.ts src/service.test.ts src/app/admin-read-service.test.ts src/ops/doctor.test.ts
python -m unittest api.test_main
```

再跑本仓库控制面与 workflow doctor：

```bash
npm run codex:workflow:doctor
npm run codex:doctor
```
