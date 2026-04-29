# Hermes ARK Coding v3 临时切换设计

日期：2026-04-19  
状态：approved  
范围：仅 Hermes / 企微普通对话链路，htops 业务模型链保持不变

## 目标

临时把 Hermes 普通对话链路切到：

- `https://ark.cn-beijing.volces.com/api/coding/v3`

并验证：

1. `hermes-gateway.service` 能正常启动
2. Hermes 自身能正常完成一轮普通文本对话
3. htops 的 bridge / worker / query api 不跟着切换

## 已确认事实

1. `hermes-gateway.service` 当前实际读取：
   - `/root/htops/.hermes-runtime/config.yaml`
2. htops 业务服务与 Hermes gateway 共用 `/root/htops/.env.runtime`
   - 因此不能通过改 `.env.runtime` 来做 Hermes-only 切换
3. `api/coding/v3` 对当前 Hermes 使用的 `gpt-5.4-mini` 不兼容
   - 直接探针返回 `UnsupportedModel`
4. 该 endpoint 可接受至少以下模型完成普通 chat completion：
   - `deepseek-v3-2-251201`
   - `doubao-seed-2-0-pro-260215`
   - `doubao-seed-2-0-code-preview-260215`

## 方案

采用 **Hermes runtime 私有配置切换**：

1. 只修改 Hermes 私有运行时文件：
   - `/root/htops/.hermes-runtime/config.yaml`
   - `/root/htops/.hermes-runtime/.env`
2. 不修改：
   - `/root/htops/.env.runtime`
   - htops 业务模型相关配置
3. 因为 `api/coding/v3` 不支持当前 GPT 模型名，临时把 Hermes 默认对话模型一并切到已实测兼容模型：
   - 推荐：`deepseek-v3-2-251201`
4. 同步把 compression 相关模型也切到同一兼容模型，避免长会话压缩时再次命中不兼容模型

## 为什么选这个方案

- **隔离性最好**：不会误伤 htops 业务链
- **回滚最简单**：恢复两个 Hermes runtime 文件即可
- **验证最直接**：重启 `hermes-gateway.service` 后即可单独烟测

## 边界

- 这是临时测试方案，不是正式生产常态方案
- 不评估 ARK coding endpoint 的长期稳定性、成本或平台策略
- 不修改 htops 召回、画像、analysis、worker 任何模型配置

## 验收

1. `hermes-gateway.service` 重启后为 `active`
2. 用 Hermes runtime 执行单轮 `chat -q` 返回正常文本
3. 运行时配置检查中可看到：
   - Hermes default model 已切到兼容模型
   - Hermes base_url 已切到 `api/coding/v3`
4. `htops-bridge.service` / `htops-scheduled-worker.service` / `htops-analysis-worker.service` / `htops-query-api.service` 未改动
