# Agent Note: AWiki 消息使用单一部署身份

Status: implemented

[English](2026-08-13-awiki-unified-agent-messaging.md) | 中文

## 问题

Harness Agent 需要在一个 Harness 进程之外交换私聊和既有群组消息，同时向对端呈现一个稳定身份。为每个 Agent 创建 SDK 实例会复制私钥状态，允许不同 Session 的身份发生偏移，并让浏览器注册承担凭证职责。把 AWiki 调用放进浏览器还会向最不可信的应用层暴露 DID 密钥和访问令牌。

首个版本需要身份注册、历史、文本和单文件附件，但不能让 Harness agent loop 绑定到一种消息网络。Web 应用尚不提供多用户 principal 隔离，而该能力还需要一套公网部署方式。

## 决策

`@deepseek-ai/dsh-awiki` 是完整的能力 seam。Service Definition 持有一个部署级 client 槽位和公开 DTO；TypeScript SDK provider 持有 AWiki 认证、凭证、持久化、协议调用、幂等和附件完整性；Remote 与工具是 Consumer。服务不公开身份选择器，因此进程中的每个 root Agent 和 subagent 都通过同一个已注册 Handle 与 DID 读取和发送。

部署只通过浏览器 Remote 注册该身份。模型工具目录不包含注册操作，注册成功后也不能替换已有持久身份。MVP 使用 AWiki Legacy 单设备注册和 transport-protected 消息。Manifest device、恢复、多设备 Join、私聊或群聊 E2EE、建群与实时投递都不属于该能力。

浏览器和模型值使用 Host 持有的 JSON-safe DTO。它们包含公开 Handle 与 DID、会话和消息 id、消息内容与附件展示元数据；不包含私钥、访问令牌、object key、nonce、上传凭证、下载 ticket、状态路径或完整附件 manifest。Host 把 provider 错误转换为固定公开消息的封闭失败词汇，按可配置大小限制解码后的附件，并且不返回远端响应正文。

浏览器插件贡献右侧 `shell.overlay` 触发器。它只调用 Host Remote，通过 Handle、手机号与 OTP 请求注册，并从浏览器安全的 Host 方法读取轮询间隔和附件限制。只有抽屉打开时才刷新会话与已选历史；关闭或卸载插件会使进行中的工作失效并停止定时器。浏览器会在读取超限文件前拒绝它，且可观察状态既不保留 SDK 凭证，也不保留附件字节。

AWiki 保持可选。`@deepseek-ai/dsh-awiki-web` 在普通 Web bundle 之后插入 Host 服务、SDK provider 和浏览器插件；常驻 Web bundle 不挂载 AWiki，也不增加其 SDK 依赖。未使用 AWiki 的安装保持不变，同时严格维持 Host → provider → UI 的加载顺序。

只读模型工具公开身份状态、会话列表和历史。文本与附件发送工具经过 `tools/pre-execute`，需要审批决策。工具调用与结果使用普通日志化工具路径，因此进入模型请求的每个 AWiki 值都能从 Session log（会话日志）重建。AWiki 仍是聊天历史的权威存储。

公网安装让 Harness 保持监听 loopback，并在其前方放置一个 HTTPS 反向代理和一个已认证用户。代理保护页面以及每条 API 或流式路由，并实施与 Host 附件限制一致的请求体上限。SDK 状态包含由 owner-only 文件权限保护的明文签名密钥与访问凭证；部署必须使用加密存储和加密备份，凭证保险库 provider 延后。附件下载仅允许精确审核过的 HTTPS origin，限制响应体，在申请授权前校验 manifest 大小，并校验摘要。这是单用户部署规则，不是多用户隔离：共享 Web origin 就是共享 AWiki 身份以及该处可用的全部 Harness 能力。

## 考虑过的替代方案

**每个 Agent 或 Session 使用一个身份。** 这种方式提供不同发送者，也能支持按 Agent 撤销，但每个 Agent 生命周期都需要注册、凭证选择、存储归属和清理。产品要求是一个可识别的部署身份，因此这些状态既增加复杂度，又产生错误的外部行为。

**由浏览器持有 AWiki SDK。** 浏览器直连可以少一次 Host 跳转，却会把 DID 私钥与令牌放进浏览器存储，并绕过 Harness Remote 的脱敏、字节上限与生命周期归属。浏览器保持为展示 Consumer。

**集成 MCP server。** MCP 工具 server 可以公开消息操作，却不提供原生浏览器注册和历史界面，还会增加另一套协议与进程生命周期。版本化 TypeScript SDK 是唯一 AWiki transport 依赖。

**集成进 Agent loop。** 把外部消息注入 core loop 可以让 AWiki 成为环境 inbox，却会为了能够使用既有 service、Remote、tool 与 client 扩展点的能力而改变提示词接纳和持久化语义。轮询仍是显式 UI 读取，不会创建未经请求的模型轮次。

**直接公开绑定 Web。** 让 Harness 监听所有网卡会缺少认证，并把一套进程级能力误当成多用户能力。loopback 加已认证的 TLS 代理明确表达了真实的单用户信任模型。

## 影响

- 一个 Harness 进程中的每个 Agent 都共享一个外部 Handle 与 DID；provider 只持有一个 SDK client，并在插件卸载时释放它。
- 注册与秘密保持在模型工具和浏览器状态之外；模型调用读取或发送操作时，其结果仍是普通的日志化工具输出。
- 私聊、既有群聊、分页历史、文本与一个附件使用同一服务。群组管理与加密消息需要后续能力工作。
- Legacy 历史使用绑定会话的不透明 offset cursor（偏移游标）读取更早页面。并发到达的新消息可能移动偏移页；全新的 Legacy state（状态）可以发现当前未读的私聊会话，但无法重建所有已经读过的私聊会话，SDK 会持久化它实际观察到的会话。
- 本集成不加密 SDK 状态文件。在凭证迁移到 vault capability 前，`0600` 权限、owner-only 父目录、加密存储、加密备份和单进程所有权都是运行要求。
- 抽屉关闭时 UI 轮询不占用后台定时器，也不声称提供实时投递。
- 独立版本化的 TypeScript SDK 是发布前置。该 SDK 版本出现在声明的软件包来源之前，Harness package 无法进行可复现安装。
- 即使反向代理提供登录，公网部署仍是单用户。每用户身份需要在 Host 全链路提供已认证 principal，以及 Agent、Session、凭证和存储归属。
