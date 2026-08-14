# `@deepseek-ai/dsh-awiki-web`

[English](README.md) | 中文

这是一个可选的 patch 层组合包，为 DeepSeek Harness Web profile 添加一个部署级 AWiki 身份。它应当放在 [`dsh-base`](../base/README.md) 和 [`dsh-web-app`](../web-app/README.md) 之后。三个有序配置行依次挂载 [`dsh-awiki`](../../awiki/awiki/README.md) Host 服务、生产 TypeScript SDK 提供方和 [`dsh-client-ui-awiki`](../../client/ui-awiki/README.md) 浏览器抽屉。本组合包不会替换 Web server 配置行，因此 Web 组合包仍默认只监听 loopback。

## 配置

启动 profile 前设置以下值：

| 环境变量 | 含义 | 默认值 |
|---|---|---|
| `DSH_AWIKI_USER_SERVICE_URL` | AWiki user service 的绝对 URL | 必填 |
| `DSH_AWIKI_USER_SERVICE_DOMAIN` | 权威 Handle 提供方域名 | 必填 |
| `DSH_AWIKI_MESSAGE_SERVICE_URL` | AWiki message service 的绝对 URL | 必填 |
| `DSH_AWIKI_MESSAGE_SERVICE_DID` | 权威消息服务 DID | 必填 |
| `DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL` | 消息服务的公开协议 endpoint | 必填 |
| `DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS` | 远端附件对象的精确 HTTPS origin JSON 数组 | `[]`（公开消息服务 origin） |
| `DSH_AWIKI_STATE_PATH` | 私有身份状态文件 | 必填 |
| `DSH_AWIKI_POLL_INTERVAL_MS` | 抽屉轮询间隔，单位为毫秒 | `5000` |
| `DSH_AWIKI_ATTACHMENT_MAX_BYTES` | 解码后附件大小上限 | `10485760` |

`DSH_AWIKI_USER_SERVICE_DOMAIN` 是权威 Handle 提供方域名，`DSH_AWIKI_MESSAGE_SERVICE_DID` 是权威消息服务 DID。两者都必须来自 AWiki 提供方配置，不得根据 API host 猜测或推导。协议记录对外发布 `DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL`，本进程则调用 `DSH_AWIKI_MESSAGE_SERVICE_URL` 指定的 base URL；即使部署为二者分配了相同 URL，也必须分别配置。Host 会在激活时拒绝缺失或无效的协议标识、格式错误的数值、超出 1,000–60,000 毫秒范围的间隔，以及非正数或非安全整数的附件上限。所有服务 URL 都必须使用 HTTPS。包含凭据或片段的 URL 会被拒绝。

远端 DID 可以引用公开消息服务之外 origin 上的附件对象。`DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS` 是一个 JSON 字符串数组，列出允许提供这些对象的精确 HTTPS origin；其中需要包含非默认端口，且不能包含路径、查询参数、凭据或片段。环境变量未设置时，bundle 会传入 `[]`，使 Host 只允许 `DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL` 的 origin；每个额外 origin 都必须显式列出。JSON 格式错误会让 profile 求值失败，Host 还会拒绝非字符串、重复或无效条目。本产品 bundle 不暴露 Host 仅供测试使用的非安全 loopback 开关。

创建一个自定义 profile，并让其 manifest 按顺序列出 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和 `@deepseek-ai/dsh-awiki-web`。`dsh plugin --profile awiki-web add ...` 会用 base 初始化不存在的自定义 profile，并按命令顺序追加已安装的组合包；先安装 Web 组合包，再安装本组合包。然后运行：

```sh
export DSH_AWIKI_USER_SERVICE_URL=https://user.awiki.example
export DSH_AWIKI_USER_SERVICE_DOMAIN=awiki.example
export DSH_AWIKI_MESSAGE_SERVICE_URL=https://message.awiki.example
export DSH_AWIKI_MESSAGE_SERVICE_DID=did:wba:messages.awiki.example
export DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL=https://message.awiki.example
export DSH_AWIKI_STATE_PATH=/var/lib/dsh-awiki/identity.json
dsh --profile awiki-web
```

## 身份与消息范围

一个运行中的部署拥有一个已注册 AWiki 身份。进程内的所有 Harness agent（智能体）和所有浏览器会话都以该身份操作；抽屉支持注册、已有私聊与群聊、历史记录、文本消息，以及每条消息一个附件。这不是多用户隔离机制。反向代理登录控制的是共享部署身份的访问权，不会为每个登录用户分配一个 AWiki 身份。

MVP 使用 AWiki Legacy 单设备身份状态和传输加密。不要让两个运行中的部署共享同一状态文件。消息正文和附件不由本组合包执行端到端加密。

## 公网部署

保持 Harness 监听 loopback，并在同一主机上放置带身份认证的 HTTPS 反向代理。身份认证必须覆盖页面、所有 API 与插件路径，以及 SSE 或 WebSocket upgrade；只保护 HTML 路由会使消息与会话操作保持暴露。代理必须保留 upgrade 和流式传输所需的 header，并在转发到 Harness 前拒绝未认证请求。

设置代理请求体上限时，需要在解码后附件上限之上计入 base64 膨胀和 JSON 封装开销。使用默认 10 MiB 附件上限时，代理请求体上限至少设为 14 MiB；修改 `DSH_AWIKI_ATTACHMENT_MAX_BYTES` 时同步调整代理和 Host 限制。

身份状态包含明文私有签名材料和访问凭证，本集成本身不加密该文件。其父目录仅允许所有者访问，由 SDK 将文件维持为 `0600`，文件应位于加密存储上，备份也只能写入经过加密且仅所有者可访问的存储。复制或恢复文件前先停止部署，并在重启前恢复相同权限。

## 模型体验

间接来自 `@deepseek-ai/dsh-awiki`，AWiki 工具 schema 与结果由该包持有；本组合包自身不添加发送给模型的内容。

#### KV Cache 影响

本组合包不添加提示词。对于继承部署工具注册表的 Agent，Host 的稳定工具 schema 会加入模型请求。

## 已知限制与延期工作

- **单一信任域**：所有通过认证的 Web 用户和所有 Harness agent 都能以同一个 AWiki 身份操作；按用户授权和身份需要拆分部署。
- **仅轮询**：抽屉只在打开时刷新，没有推送通知通道。
- **Legacy 单设备状态**：不支持并发使用同一状态文件，端到端加密延期实现。
