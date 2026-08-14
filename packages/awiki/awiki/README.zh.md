# @deepseek-ai/dsh-awiki

[English](README.md) | 中文

AWiki Host 服务把一个部署级统一身份连接到浏览器 Remote 方法和五个模型工具。该服务消费可替换的高层 TypeScript client；`@deepseek-ai/dsh-awiki/provider` 注册生产用 `@anp/typescript-sdk` 实现，keyless example 可以通过 `registerClientFactory()` 注册由 effect 持有的 fake。

## 配置

先加载服务，再加载一个 provider：

```yaml
- id: awiki
  name: '@deepseek-ai/dsh-awiki'
  config:
    userServiceUrl: https://users.awiki.example
    userServiceDomain: awiki.example
    messageServiceUrl: https://messages.awiki.example
    messageServicePublicUrl: https://messages.awiki.example
    messageServiceDid: did:wba:messages.awiki.example
    allowedAttachmentOrigins:
      - https://messages.awiki.example
      - https://peer-home.awiki.example
    statePath: /var/lib/dsh/awiki/identity.json
    attachmentMaxBytes: 10485760
    pollIntervalMs: 3000
- id: awiki-provider
  name: '@deepseek-ai/dsh-awiki/provider'
```

六个 SDK 连接字段全部必填。`userServiceDomain` 是 Handle provider domain，`messageServiceDid` 是权威的 bare-domain `did:wba` 消息服务 DID，`messageServicePublicUrl` 是发布到该身份 DID 文档中的外部可访问 base；三者都不会从 API URL 推断。服务 URL 必须使用 HTTPS。仅源码可用的 `allowInsecureLoopbackForTesting` 开关允许本地测试使用回环 HTTP，公网 profile 绝不能启用。含凭据或 fragment 的 URL 会在加载时失败。

`allowedAttachmentOrigins` 是精确 HTTPS origin allowlist，用于约束从发送方 DID 文档发现的附件 object URL。默认值是 `messageServicePublicUrl` 的 origin；需要下载哪些经评审 peer Home 的附件，就加入对应 origin。包含 path、query、重复值或非 HTTPS origin 会在加载时失败。`attachmentMaxBytes` 默认为 10 MiB，同时在 Host、SDK 与浏览器预检内生效，且必须是正安全整数。`pollIntervalMs` 默认为 3000，且必须是 1000 至 60000 的整数。只有轮询间隔和附件上限会通过浏览器 Remote 传递；SDK 连接值、origin policy 与状态路径仅留在 Host。

## 服务与 provider 生命周期

`ctx.awiki` 实现 client-safe 的 `AwikiHostClient` 操作：公开配置、身份状态、Legacy 注册 OTP 与完成注册、会话、历史、文本、附件上传和附件下载。每个操作都返回 `AwikiResult`；服务会把 SDK 失败归一化为固定公开代码和消息，绝不返回远端响应正文、cause、token、私钥、上传 ticket 或本地路径。

`registerClientFactory(factory)` 只接受一个同步高层 client factory，并返回异步 disposer。provider 必须从自己的 `ctx.effect` 返回该 disposer。disposer 会先清除 client slot，再等待 `client.dispose()`，因此 teardown 达到静止状态期间的新操作会 fail closed。Host 服务先卸载时，也会等待同一条幂等清理路径。没有 provider 时发起调用，会返回公开 `remote` 失败 `AWiki client provider is unavailable.`。

附件上传只接受规范的标准 Base64，并在调用 provider 前，对完整解码字节执行配置上限。附件下载依赖 SDK 的 SHA-256 校验，再根据部署上限和返回 metadata 复查字节长度，最后为 Remote 编码为 Base64。公开附件数据只包含 id、名称、MIME 类型、大小和 SHA-256。

## Remote 与模型操作

只有标注 `@Remote` 的方法会进入 Typert 投影。`registerClientFactory()` 只用于同进程调用。注册身份仅由浏览器完成，不提供模型工具。

模型会得到五个工具：`awiki_identity_status`、`awiki_list_conversations`、`awiki_history`、`awiki_send_message` 和 `awiki_send_attachment`。两个发送工具在 `tools/pre-execute` 中返回执行时 `ask` 决策；工具 registry 会通过已配置的 approval 服务处理该决策，没有批准就拒绝执行。浏览器 Remote 发送不经过模型工具审批。部署认证会授权每个能够访问该 Remote 的浏览器 client；Host 不会证明真实用户手势。

## 模型体验

### AWiki 工具

#### 模型看到的内容

五个 AWiki schema 及其结构化 JSON 结果会出现在生成的[工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-awiki)中。读取结果包含公开身份、会话、消息和附件字段。只有审批决策允许执行后，发送结果才会出现。

#### Token 影响

此插件挂载期间，工具 schema 会增加固定请求成本。每个已调用结果会根据返回页或已发送消息增加数据相关 token；只有附件工具参数或浏览器操作携带附件字节时，附件结果才包含 metadata 和 Base64。

#### KV Cache 影响

只要插件集合或 schema 不变，稳定工具 schema 会保留可复用的提示词前缀。工具调用及结果会追加到后续请求历史，不会重写此前缀。

## 已知限制与暂缓事项

- **一个部署身份**：服务只有一个 provider 和一个持久身份；多用户、身份切换、恢复和多设备 join 不在本包范围内。
- **轮询消费方**：Host 会公开浏览器轮询间隔，但不拥有 WebSocket、SSE、后台轮询器或自动 Agent 唤醒。
- **仅支持已有群组**：会话和发送方法使用已有私聊或群聊目标；不支持建群和成员管理。
- **Legacy 私聊发现**：SDK 会合并已持久化会话和当前未读 inbox。全新 state 无法重建 SDK 观察之前已经读过的私聊会话。更早历史的 cursor 使用 Legacy offset，因此并发到达的新消息可能移动页面。
- **单个有界附件**：每次发送会在内存中携带一个完整 Base64 附件；流式上传和多附件消息暂缓。
- **只有传输加密**：公网服务与附件 origin 必须使用 HTTPS，但该集成未实现 Direct E2EE、Group E2EE、MLS 和密钥轮换。
