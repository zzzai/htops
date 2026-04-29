# Hermes 企业微信小红书链接 sidecar 设计

日期：2026-04-19  
状态：approved-for-implementation  
范围：Hermes / htops / AutoCLI sidecar / 企业微信异步补发

## 1. 背景

当前 Hermes 在企业微信里收到带 URL 的消息时，不会走普通轻量问答；而小红书链接读取又不适合直接塞进 Hermes 主同步回答链路，因为它依赖：

- 浏览器真实登录态
- Chrome 扩展与 Browser session reuse
- 外部 sidecar 命令执行
- 较不稳定的站点侧时延与登录失效

用户已经明确确认两件事：

1. 采用 **B 路径**：`Hermes / htops bridge + bounded sidecar`，不把 AutoCLI 直接嵌到 Hermes 主链。
2. 交互采用 **先回“收到，正在读取。”，随后补发摘要**。

## 2. 目标

在 Ubuntu Desktop + GUI Chrome 常驻机器上，为 Hermes 增加一条可生产落地的小红书链接读取链路：

- 企微里发送小红书链接
- Hermes 立即回一条“收到，正在读取。”
- htops bridge 异步调用 AutoCLI sidecar
- sidecar 读取笔记标题 / 作者 / 正文 / 标签 / 可见互动信息
- htops 组织成摘要并二次回发到同一会话

## 3. 非目标

- 不做任意网页通用抓取平台
- 不把 cookie 落到 PostgreSQL / htops 配置里
- 不在 `src/runtime.ts` 中新增业务入口职责
- 不在首版实现里做多链接批处理 / 多平台统一路由
- 不把这条链路并入门店经营语义 capability graph

## 4. 方案比较

### 方案 A：直接把 AutoCLI 调用塞进 Hermes 同步主链

优点：

- 链路最短

缺点：

- 站点时延、浏览器状态、登录失效会污染主问答路径
- Hermes 同步等待体验差
- 失败模式难隔离

结论：不采用。

### 方案 B：Hermes frontdoor 检测链接，bridge 走 accepted + deferred，AutoCLI 作为 bounded sidecar

优点：

- 利用现有 `accepted -> deferred follow-up` 机制
- 失败与登录态问题被隔离在 sidecar
- 不污染主问答同步路径
- 后续可扩展到其他社媒链接

缺点：

- 需要补一层 sidecar service 与 adapter 安装面

结论：**采用**。

### 方案 C：自研 Playwright / Scrapling 抓小红书

优点：

- 可完全掌控

缺点：

- 成本高
- 登录态维护复杂
- 首版落地慢

结论：首版不采用。

## 5. 总体设计

### 5.1 前门分流

在 `hermes_overrides/sitecustomize.py` 增加一个 **Xiaohongshu inbound lane**：

- 识别 `xiaohongshu.com` / `xhslink.com` 链接
- 命中后直接走 `_call_inbound_bridge(event)`
- lane 记为 `xiaohongshu-bridge`
- 不再走 general-lite，也不依赖 `should_route_to_htops()`

这样可以避免 URL 类消息被误判为普通问答或复杂请求。

### 5.2 bridge / accepted 机制

`src/app/message-entry-service.ts` 继续复用现有 accepted 机制：

- 普通 inbound 仍是默认 `收到，在处理。`
- 小红书链接 inbound 改为 **定制 accept text**：`收到，正在读取。`
- 如果 2 秒内未完成，bridge 先返回 accepted
- 最终摘要通过现有 deferred notification sender 回发

### 5.3 bounded owner service

新增 `src/app/xiaohongshu-link-service.ts`，只负责：

1. 从消息中提取第一条小红书链接
2. 调 AutoCLI sidecar 读取内容
3. 解析 sidecar 输出
4. 组织最终摘要文案

它不负责：

- 企业微信发送
- bridge HTTP
- Hermes frontdoor
- 通用网页抓取

### 5.4 AutoCLI sidecar

使用 AutoCLI 的 Browser 模式，但不直接依赖内置 `xiaohongshu download`，而是提供一个**本地自定义 adapter**：

`tools/autocli-adapters/xiaohongshu/read-note.yaml`

原因：

- 内置 `download` 主要做媒体下载，不直接产出正文摘要
- 首版需求是“读链接并回复”，需要标题、作者、正文、标签等结构化内容
- AutoCLI 支持把用户自定义 adapter 放到 `~/.autocli/adapters/`

自定义 adapter 行为：

- 接收 **note id 或完整 URL**
- 若输入是 URL，优先直接 `navigate` 到原始 URL（兼容 `xhslink.com`）
- 页面稳定后抽取：
  - `noteId`
  - `resolvedUrl`
  - `title`
  - `author`
  - `publishedAt`
  - `content`
  - `tags`
  - `likeCount / collectCount / commentCount`（能取到则带）

### 5.5 AI 融合方式

首版必须保证 **无模型时也能稳定工作**：

- 默认：确定性摘要（标题 + 作者 + 核心内容摘录 + 标签）
- 可选增强：若 `customerGrowthAi.followupSummarizer` 已启用，则用现有 AI JSON task 做更短摘要和推荐回复

即：

- **deterministic first**
- **AI optional enhancement**

这样既满足“AI 能力融入”，又不让功能依赖额外模型配置才能工作。

## 6. 数据流

```text
WeCom message
  -> Hermes sitecustomize frontdoor
  -> detect Xiaohongshu URL
  -> POST /v1/messages/inbound
  -> message-entry-service
  -> xiaohongshu-link-service
  -> AutoCLI sidecar (Chrome extension + logged-in browser)
  -> read-note adapter output JSON
  -> deterministic / AI-enhanced summary
  -> immediate or deferred bridge reply
  -> send follow-up to same WeCom conversation
```

## 7. 状态与安全边界

### 7.1 登录态

登录态保存在 **GUI Chrome 的本地 profile**，不进入：

- PostgreSQL
- htops.json
- `.env.runtime`

### 7.2 失败分层

失败统一分为：

1. `autocli-missing`
2. `extension-not-connected-or-login-expired`
3. `content-parse-failed`
4. `unexpected-sidecar-error`

对应对用户的回复应是安全、可操作的：

- 缺 binary：提示 sidecar 未安装完成
- 扩展/登录失效：提示稍后重试或需要管理员重新连通浏览器态
- 解析失败：提示链接可达但正文未成功读取

### 7.3 不做的事

- 不保存原始 cookie
- 不把原始正文长期入库
- 不让 sidecar 失败阻塞 Hermes 普通问答

## 8. 配置设计

新增一个 bounded config block：

`inboundLinkReaders.xiaohongshu`

建议字段：

- `enabled`
- `autocliBin`
- `timeoutMs`
- `browserTimeoutMs`
- `acceptText`
- `maxContentChars`

默认安全值：

- 默认关闭
- accept 文案默认 `收到，正在读取。`
- 文本截断防止超长回包

## 9. 测试设计

### 9.1 Hermes frontdoor

- 命中小红书链接时，优先走 inbound bridge
- bridge 不可用时返回安全 fallback
- 记录 `lane=xiaohongshu-bridge`

### 9.2 message-entry-service

- 小红书慢请求在 2 秒后返回 accepted
- accepted 文案为 `收到，正在读取。`
- sidecar 完成后通过 deferred sender 回发摘要

### 9.3 xiaohongshu-link-service

- 能从消息中提取第一条 xiaohongshu / xhslink URL
- 能构造 AutoCLI argv
- sidecar stdout 为 JSON 时能成功解析
- sidecar 缺失 / 失败时能返回安全文案
- AI 不可用时退回 deterministic summary

## 10. 运维落地

首版需要额外准备：

1. 安装 `autocli` binary
2. 将 `read-note.yaml` 同步到 `~/.autocli/adapters/xiaohongshu/`
3. 在 GUI Chrome 中加载 AutoCLI 扩展
4. 用目标账号登录小红书
5. 运行 `autocli doctor`

## 11. 验收标准

满足以下条件即可视为首版可用：

1. 企微发一条小红书链接，Hermes 先回 `收到，正在读取。`
2. 30-60 秒内补发一条摘要
3. 摘要至少包含：标题 / 作者 / 正文核心内容
4. sidecar 不可用时，用户能收到明确失败提示，而不是静默失败
5. 普通门店经营问答与普通聊天路径不受影响

