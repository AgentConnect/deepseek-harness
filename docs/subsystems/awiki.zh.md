# AWiki 消息

[English](awiki.md) | 中文

[`@deepseek-ai/dsh-awiki`](../../packages/awiki/awiki)为一个 Harness 进程提供一个 AWiki 身份。每个 Agent 都使用同一个 `ctx.awiki` 服务；API 不提供身份选择器，注册也不能替换持久化身份。

生产 provider 使用版本化 `@anp/typescript-sdk`。provider 持有 DID 密钥、访问令牌、状态文件持久化、Handle 解析、请求认证、幂等、附件传输、完整性校验与 client 释放。Host 与浏览器类型只包含公开身份、会话、消息、附件元数据、封闭业务失败，以及 Remote 传输点上的规范 Base64。

注册只对浏览器开放，并使用 AWiki Legacy 单设备注册。模型工具可以读取身份、会话列表与历史；文本和附件发送需要经过普通工具审批路径。私聊与既有群聊使用 transport-protected profile。Manifest device、恢复、多设备 Join、E2EE、建群、未经请求的模型轮次与实时投递都不属于本子系统。

浏览器通过 Remote 读取 `pollIntervalMs` 与 `attachmentMaxBytes`，在 Base64 转换前拒绝超大文件，且只在 AWiki 抽屉打开时轮询。同一附件上限也适用于 SDK 完整解码后的上传与下载。附件下载同时使用 `messageId` 与 `attachmentId` 寻址，因为 attachment id 只在单条消息内唯一。

真源：[`packages/awiki/awiki/src/types.ts`](../../packages/awiki/awiki/src/types.ts)

## 公开身份与消息

浏览器和模型只能接收公开身份与消息值。稳定标识符是不透明 branded string（标记字符串），附件元数据绝不包含 object key、ticket、token、nonce 或本地路径。

```ts type-equiv
/** Public identity state. Secret keys and tokens never enter this type. */
interface AwikiIdentity {
  readonly handle: AwikiHandle
  readonly did: AwikiDid
  readonly registeredAt: number
}
```

```ts type-equiv
/** Attachment metadata safe for browsers, models, logs, and transcripts. */
interface AwikiAttachment {
  readonly id: AwikiAttachmentId
  readonly fileName: string
  readonly mimeType: string
  readonly size: number
  readonly sha256: string
}
```

```ts type-equiv
/** Public direct or group message. */
interface AwikiMessage {
  readonly id: AwikiMessageId
  readonly conversationId: AwikiConversationId
  readonly conversationKind: AwikiConversation['kind']
  readonly senderDid: AwikiDid
  readonly senderHandle?: AwikiHandle
  readonly sentAt: number
  readonly outgoing: boolean
  readonly content: AwikiMessageContent
}
```

```ts type-equiv
/** Request attachment bytes visible to the deployment identity. */
interface AwikiDownloadAttachmentRequest {
  readonly attachmentId: AwikiAttachmentId
  readonly messageId: AwikiMessageId
}
```

```ts type-equiv
/** Public AWiki operation result. */
type AwikiResult<Value> = AwikiSuccess<Value> | AwikiRejected
```

Legacy 会话发现将已持久化会话、当前未读私聊会话和完整的既有群聊列表合并。全新的 Legacy state 无法重建 SDK 观察它之前已经读过的私聊会话。每个历史返回页内部按从旧到新排序；不透明 cursor 请求更早页面，不带 cursor 的读取刷新最新页面。

[AWiki Agent Note](../../.agents/notes/implemented/feature/2026-08-13-awiki-unified-agent-messaging.md)持有身份与部署依据。包 [README](../../packages/awiki/awiki/README.md)定义配置与运行限制。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxawiki--awikiservice"></a>

### `ctx.awiki` — `AwikiService`

Deployment-wide AWiki service over one replaceable TypeScript client provider.

```ts cordis-catalog
/**
 * Register the deployment's sole client factory. The caller must return the
 * resulting disposer from its own `ctx.effect`; disposal clears the slot
 * before awaiting the client's quiescence and is idempotent.
 * @param factory - synchronous factory for one owned high-level client.
 * @returns asynchronous disposer for the exact registered client.
 */
registerClientFactory(factory: AwikiClientFactory): () => Promise<void>

/**
 * Read settings needed by the browser presentation.
 * @returns Browser-safe polling configuration without SDK endpoints or state paths.
 */
@Remote getConfig(): Promise<AwikiResult<AwikiRuntimeConfig>>

/**
 * Read the deployment's identity status.
 * @returns The public deployment identity or `null`.
 */
@Remote getIdentity(): Promise<AwikiResult<AwikiIdentity | null>>

/**
 * Send one Legacy registration verification code.
 * @param request - Handle and phone used for the registration challenge.
 * @returns Public retry timing or a closed failure.
 */
@Remote sendRegistrationOtp(request: AwikiRegistrationOtpRequest): Promise<AwikiResult<AwikiRegistrationOtpResult>>

/**
 * Register and persist the deployment's only AWiki identity.
 * @param request - Handle, phone, and verification code for registration.
 * @returns The new public identity or a closed failure.
 */
@Remote registerIdentity(request: AwikiRegistrationRequest): Promise<AwikiResult<AwikiIdentity>>

/**
 * List direct and existing group conversations.
 * @param request - Optional opaque cursor and page limit.
 * @returns One page of direct and existing group conversations.
 */
@Remote listConversations(request?: AwikiPageRequest): Promise<AwikiResult<AwikiPage<AwikiConversation>>>

/**
 * Read one direct or group conversation history page.
 * @param request - Conversation id, optional cursor, and page limit.
 * @returns One chronological history page.
 */
@Remote getHistory(request: AwikiHistoryRequest): Promise<AwikiResult<AwikiPage<AwikiMessage>>>

/**
 * Send one text message through the deployment identity.
 * @param request - Target, text, and idempotency key.
 * @returns The accepted public message or a closed failure.
 */
@Remote sendText(request: AwikiSendTextRequest): Promise<AwikiResult<AwikiMessage>>

/**
 * Upload and send one attachment after Host validation.
 * @param request - Target, attachment metadata and Base64 bytes, caption, and idempotency key.
 * @returns The accepted attachment message or a closed failure.
 */
@Remote async sendAttachment(request: AwikiSendAttachmentRequest): Promise<AwikiResult<AwikiMessage>>

/**
 * Download and encode one provider-verified attachment.
 * @param request - Containing message id and attachment id.
 * @returns Verified public metadata and canonical Base64 bytes, or a closed failure.
 */
@Remote async downloadAttachment(request: AwikiDownloadAttachmentRequest): Promise<AwikiResult<AwikiDownloadedAttachment>>
```

Source: [`packages/awiki/awiki/src/index.ts:256`](../../packages/awiki/awiki/src/index.ts)
<!-- END GENERATED cordis-surface -->
