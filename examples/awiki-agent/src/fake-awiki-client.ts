/** In-memory AWiki SDK provider for the real-Loader keyless composition. */

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AwikiAttachment,
  AwikiAttachmentId,
  AwikiConversation,
  AwikiConversationId,
  AwikiDid,
  AwikiHandle,
  AwikiHistoryRequest,
  AwikiIdentity,
  AwikiMessage,
  AwikiMessageId,
  AwikiPage,
  AwikiPageRequest,
  AwikiRegistrationOtpRequest,
  AwikiRegistrationOtpResult,
  AwikiRegistrationRequest,
  AwikiSendTextRequest,
} from '@deepseek-ai/dsh-awiki/types'
import type {
  AwikiSdkClient,
} from '@deepseek-ai/dsh-awiki'

type FakeAttachmentRequest = Parameters<AwikiSdkClient['sendAttachment']>[0]
type FakeDownloadedAttachment = Awaited<ReturnType<AwikiSdkClient['downloadAttachment']>>

const SHARED_DID = 'did:awiki:snapshot:shared' as AwikiDid
const SHARED_HANDLE = 'harness@awiki.info' as AwikiHandle
const DIRECT_ID = 'conversation-direct' as AwikiConversationId
const GROUP_ID = 'conversation-group' as AwikiConversationId
const PEER_DID = 'did:awiki:snapshot:peer' as AwikiDid

const IDENTITY: AwikiIdentity = {
  did: SHARED_DID,
  handle: SHARED_HANDLE,
  registeredAt: 1_750_000_000_000,
}

const CONVERSATIONS: readonly AwikiConversation[] = [
  {
    kind: 'direct',
    id: DIRECT_ID,
    peerDid: PEER_DID,
    peerHandle: 'peer@awiki.info' as AwikiHandle,
    title: 'Snapshot peer',
    lastMessageAt: 1_750_000_000_100,
  },
  {
    kind: 'group',
    id: GROUP_ID,
    groupDid: 'did:awiki:group:snapshot' as AwikiDid,
    title: 'Snapshot group',
    lastMessageAt: 1_750_000_000_200,
  },
]

const INITIAL_MESSAGE: AwikiMessage = {
  id: 'message-initial' as AwikiMessageId,
  conversationId: DIRECT_ID,
  conversationKind: 'direct',
  senderDid: PEER_DID,
  senderHandle: 'peer@awiki.info' as AwikiHandle,
  sentAt: 1_750_000_000_100,
  outgoing: false,
  content: { kind: 'text', text: 'hello from the snapshot peer' },
}

function page<Item>(items: readonly Item[]): AwikiPage<Item> {
  return { items, hasMore: false }
}

function conversationFor(kind: 'direct' | 'group'): AwikiConversationId {
  return kind === 'direct' ? DIRECT_ID : GROUP_ID
}

/** Stateful fake of the high-level TypeScript SDK used only by this example. */
export class FakeAwikiClient implements AwikiSdkClient {
  private readonly messages: AwikiMessage[] = [INITIAL_MESSAGE]
  private readonly attachments = new Map<string, FakeDownloadedAttachment>()
  private readonly idempotent = new Map<string, AwikiMessage>()
  private nextMessage = 1
  private disposed = false

  async getIdentity(): Promise<AwikiIdentity | null> {
    return IDENTITY
  }

  async sendRegistrationOtp(_request: AwikiRegistrationOtpRequest): Promise<AwikiRegistrationOtpResult> {
    return { retryAfterSeconds: 60, retryAt: '2025-06-15T15:07:40.000Z' }
  }

  async registerIdentity(_request: AwikiRegistrationRequest): Promise<AwikiIdentity> {
    return IDENTITY
  }

  async listConversations(_request?: AwikiPageRequest): Promise<AwikiPage<AwikiConversation>> {
    return page(CONVERSATIONS)
  }

  async getHistory(request: AwikiHistoryRequest): Promise<AwikiPage<AwikiMessage>> {
    return page(this.messages.filter(message => message.conversationId === request.conversationId))
  }

  async sendText(request: AwikiSendTextRequest): Promise<AwikiMessage> {
    const existing = this.idempotent.get(request.idempotencyKey)
    if (existing !== undefined) return existing
    const message = this.outgoing(request.target.kind, { kind: 'text', text: request.text })
    this.messages.push(message)
    this.idempotent.set(request.idempotencyKey, message)
    return message
  }

  async sendAttachment(request: FakeAttachmentRequest): Promise<AwikiMessage> {
    const existing = this.idempotent.get(request.idempotencyKey)
    if (existing !== undefined) return existing
    const sha256 = createHash('sha256').update(request.attachment.bytes).digest('hex')
    const id = `attachment-${this.attachments.size + 1}` as AwikiAttachmentId
    const attachment: AwikiAttachment = {
      id,
      fileName: request.attachment.fileName,
      mimeType: request.attachment.mimeType,
      size: request.attachment.bytes.byteLength,
      sha256,
    }
    const message = this.outgoing(request.target.kind, {
      kind: 'attachment',
      attachment,
      ...request.caption === undefined ? {} : { caption: request.caption },
    })
    this.attachments.set(`${message.id}:${id}`, { attachment, bytes: request.attachment.bytes })
    this.messages.push(message)
    this.idempotent.set(request.idempotencyKey, message)
    return message
  }

  async downloadAttachment(request: Parameters<AwikiSdkClient['downloadAttachment']>[0]): Promise<FakeDownloadedAttachment> {
    const download = this.attachments.get(`${request.messageId}:${request.attachmentId}`)
    if (download === undefined) throw new Error('snapshot attachment is unavailable')
    return download
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await writeFile('.awiki-fake-disposed', 'disposed\n', 'utf8')
  }

  private outgoing(
    kind: 'direct' | 'group',
    content: AwikiMessage['content'],
  ): AwikiMessage {
    if (this.disposed) throw new Error('snapshot client is disposed')
    const number = this.nextMessage
    this.nextMessage += 1
    return {
      id: `message-outgoing-${number}` as AwikiMessageId,
      conversationId: conversationFor(kind),
      conversationKind: kind,
      senderDid: SHARED_DID,
      senderHandle: SHARED_HANDLE,
      sentAt: 1_750_000_001_000 + number,
      outgoing: true,
      content,
    }
  }
}

export const name = 'awiki-fake-provider'
export const inject = ['awiki']

/** Register one shared fake SDK client for every Harness agent. */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.awiki.registerClientFactory(() => new FakeAwikiClient()),
    'fake AWiki client',
  )
}
