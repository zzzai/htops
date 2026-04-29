# Runtime provider switch design

日期：2026-04-19  
状态：approved  
范围：Hermes gateway 与 htops 运行时模型供应商切换

## 目标

只切换：

- `base_url`
- `api_key`

不切换：

- 任何现有 `model` 名称
- 业务代码
- 测试样例

## 方案

采用最小运行时变更：

1. 更新 `/root/htops/.env.runtime`
   - 让 htops 相关 OpenAI-compatible 调用统一切到新网关
2. 更新 `/root/htops/.hermes-runtime/config.yaml`
   - 让 `hermes-gateway.service` 当前实际运行的 Hermes runtime 切到新网关
3. 顺手对齐 `/root/.hermes/config.yaml` 与 `/root/.hermes/.env`
   - 避免后续手工 CLI 或备用 runtime 仍然走旧配置

## 边界

- 不改模型名
- 不改 repo 示例文件之外的业务逻辑
- 不把密钥写入源码
- 改动前先备份
- 改动后重启相关 systemd 服务并验证

## 验收

1. `hermes-gateway.service` 正常重启
2. `htops-bridge.service` / `htops-scheduled-worker.service` / `htops-analysis-worker.service` / `htops-query-api.service` 正常重启
3. 运行时摘要中 `bridge` 与 `Hermes runtime config` 指向新 `base_url`
4. `.env.runtime` 中 `OPENAI_MODEL` 保持原值

