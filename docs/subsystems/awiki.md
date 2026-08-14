# AWiki messaging

English | [中文](awiki.zh.md)

[`@deepseek-ai/dsh-awiki`](../../packages/awiki/awiki) provides one AWiki identity for one Harness process. Every Agent uses the same `ctx.awiki` service; the API has no identity selector and registration cannot replace a persisted identity.

The production provider consumes the versioned `@anp/typescript-sdk`. The provider owns DID keys, access tokens, state-file persistence, Handle resolution, request authentication, idempotency, attachment transfer, integrity verification, and client disposal. Host and browser types contain only public identity, conversation, message, attachment metadata, closed business failures, and canonical Base64 at the Remote transfer point.

Registration is browser-only and uses AWiki Legacy single-device registration. Model tools can read identity, conversation lists, and history; text and attachment sends require the ordinary tool approval path. Direct and existing-group messages use the transport-protected profile. Manifest devices, recovery, multi-device joins, E2EE, group creation, unsolicited model turns, and real-time delivery are not part of this subsystem.

The browser reads `pollIntervalMs` and `attachmentMaxBytes` through the Remote, rejects oversized files before Base64 conversion, and polls only while its AWiki drawer is open. The same attachment limit applies to complete decoded SDK uploads and downloads. Attachment downloads address both `messageId` and `attachmentId` because the attachment identifier is unique only within one message.

Source: [`packages/awiki/awiki/src/types.ts`](../../packages/awiki/awiki/src/types.ts)

## Public identity and messages

The browser and model receive public identity and message values only. Stable identifiers are opaque branded strings, and attachment metadata never contains an object key, ticket, token, nonce, or local path.

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

Legacy conversation discovery combines persisted conversations with current unread Direct conversations and the complete existing-group list. A fresh Legacy state cannot reconstruct Direct conversations that were already read before this SDK observed them. History pages are ordered oldest-to-newest within each returned page; an opaque cursor requests an older page, while a cursor-free read refreshes the newest page.

The [AWiki Agent Note](../../.agents/notes/implemented/feature/2026-08-13-awiki-unified-agent-messaging.md) owns the identity and deployment rationale. The package [README](../../packages/awiki/awiki/README.md) defines configuration and operational limits.

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
