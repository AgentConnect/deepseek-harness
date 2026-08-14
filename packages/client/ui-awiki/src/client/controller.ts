/** React-free browser controller for the deployment's one AWiki identity. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AwikiAttachmentId,
  AwikiConversation,
  AwikiConversationId,
  AwikiDownloadedAttachment,
  AwikiHistoryRequest,
  AwikiIdentity,
  AwikiMessage,
  AwikiMessageId,
  AwikiPage,
  AwikiPageRequest,
  AwikiRegistrationOtpRequest,
  AwikiRegistrationOtpResult,
  AwikiRegistrationRequest,
  AwikiResult,
  AwikiRuntimeConfig,
  AwikiSendAttachmentRequest,
  AwikiSendTextRequest,
} from '@deepseek-ai/dsh-awiki/types'

/** The generated `remote.awiki` methods consumed by this controller. */
export interface AwikiRemote {
  /** Read browser-safe Host polling policy. */
  getConfig: () => Promise<RemoteResult<AwikiResult<AwikiRuntimeConfig>>>
  /** Read the deployment's public identity, if registered. */
  getIdentity: () => Promise<RemoteResult<AwikiResult<AwikiIdentity | null>>>
  /** Request one registration verification code. */
  sendRegistrationOtp: (request: AwikiRegistrationOtpRequest) => Promise<RemoteResult<AwikiResult<AwikiRegistrationOtpResult>>>
  /** Register and persist the deployment's sole identity. */
  registerIdentity: (request: AwikiRegistrationRequest) => Promise<RemoteResult<AwikiResult<AwikiIdentity>>>
  /** List one page of direct and group conversations. */
  listConversations: (request?: AwikiPageRequest) => Promise<RemoteResult<AwikiResult<AwikiPage<AwikiConversation>>>>
  /** Read one conversation history page. */
  getHistory: (request: AwikiHistoryRequest) => Promise<RemoteResult<AwikiResult<AwikiPage<AwikiMessage>>>>
  /** Send one idempotent text message. */
  sendText: (request: AwikiSendTextRequest) => Promise<RemoteResult<AwikiResult<AwikiMessage>>>
  /** Send one idempotent attachment message. */
  sendAttachment: (request: AwikiSendAttachmentRequest) => Promise<RemoteResult<AwikiResult<AwikiMessage>>>
  /** Download one attachment by containing message and attachment identity. */
  downloadAttachment: (request: {
    attachmentId: AwikiAttachmentId
    messageId: AwikiMessageId
  }) => Promise<RemoteResult<AwikiResult<AwikiDownloadedAttachment>>>
}

/** Load phase of the drawer's Host-owned data. */
export type AwikiControllerStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable drawer data published through the framework hook binder. */
export interface AwikiView {
  readonly status: AwikiControllerStatus
  readonly identity: AwikiIdentity | null
  readonly conversations: readonly AwikiConversation[]
  readonly conversationsHasMore: boolean
  readonly selectedConversationId: AwikiConversationId | null
  readonly messages: readonly AwikiMessage[]
  readonly historyHasMore: boolean
  readonly pending: string | null
  readonly error: string | null
  readonly attachmentMaxBytes: number
}

/** Settled user operation result with one display-safe failure. */
export type AwikiActionResult<Value = void> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string }

const INITIAL_VIEW: AwikiView = Object.freeze({
  status: 'cold',
  identity: null,
  conversations: Object.freeze([]),
  conversationsHasMore: false,
  selectedConversationId: null,
  messages: Object.freeze([]),
  historyHasMore: false,
  pending: null,
  error: null,
  attachmentMaxBytes: 0,
})

/** Flatten the carrier and business result once for every controller caller. */
async function call<Value>(operation: () => Promise<RemoteResult<AwikiResult<Value>>>): Promise<AwikiActionResult<Value>> {
  try {
    const carried = await operation()
    if (!carried.ok) return { ok: false, error: `连接 AWiki Host 失败：${carried.error.message}` }
    if (!carried.value.ok) {
      return { ok: false, error: `${carried.value.error.code}：${carried.value.error.message}` }
    }
    return { ok: true, value: carried.value.value }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `AWiki 调用失败：${error.message}` : 'AWiki 调用失败',
    }
  }
}

/** Append unique values while retaining existing references. */
function appendUnique<T>(current: readonly T[], incoming: readonly T[], id: (value: T) => string): readonly T[] {
  const seen = new Set(current.map(id))
  const appended: T[] = []
  for (const value of incoming) {
    const key = id(value)
    if (seen.has(key)) continue
    seen.add(key)
    appended.push(value)
  }
  return [...current, ...appended]
}

/** Prepend unique values while retaining the existing tail. */
function prependUnique<T>(current: readonly T[], incoming: readonly T[], id: (value: T) => string): readonly T[] {
  const seen = new Set(current.map(id))
  const prepended: T[] = []
  for (const value of incoming) {
    const key = id(value)
    if (seen.has(key)) continue
    seen.add(key)
    prepended.push(value)
  }
  return [...prepended, ...current]
}

/** Resolve one listed conversation into the send target accepted by AWiki. */
function targetOf(conversation: AwikiConversation): AwikiSendTextRequest['target'] {
  return conversation.kind === 'direct'
    ? { kind: 'direct', peer: conversation.peerDid }
    : { kind: 'group', group: conversation.groupDid }
}

/** Browser object layer for identity, conversations, history, and polling. */
export class AwikiController implements HostObservable<AwikiView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private config: AwikiRuntimeConfig | null = null
  private conversationsCursor: AwikiPage<AwikiConversation>['nextCursor']
  private historyCursor: AwikiPage<AwikiMessage>['nextCursor']
  private timer: ReturnType<typeof setInterval> | undefined
  private generation = 0
  private disposed = false
  private polling = false

  /** @param remote - generated Host Remote namespace. */
  constructor(private readonly remote: AwikiRemote) {}

  /** Return the cached immutable view. */
  getSnapshot = (): AwikiView => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load Host policy and identity, then start polling while the drawer remains open.
   * @returns successful readiness or one display-safe Host failure.
   */
  async open(): Promise<AwikiActionResult> {
    if (this.disposed) return { ok: false, error: 'AWiki 插件已卸载' }
    this.close()
    const generation = this.generation
    this.publish({ ...INITIAL_VIEW, status: 'loading' })
    const config = await call(() => this.remote.getConfig())
    if (!this.current(generation)) return { ok: true, value: undefined }
    if (!config.ok) return this.fail(config.error)
    this.config = config.value
    const identity = await call(() => this.remote.getIdentity())
    if (!this.current(generation)) return { ok: true, value: undefined }
    if (!identity.ok) return this.fail(identity.error)
    this.publish({
      ...this.view,
      status: 'ready',
      identity: identity.value,
      error: null,
      attachmentMaxBytes: config.value.attachmentMaxBytes,
    })
    if (identity.value !== null) {
      const listed = await this.refreshConversations(generation)
      if (!listed.ok) return listed
    }
    if (this.current(generation)) {
      this.timer = setInterval(() => { void this.poll(generation) }, this.config.pollIntervalMs)
    }
    return { ok: true, value: undefined }
  }

  /** Stop polling and invalidate all in-flight drawer work. */
  close(): void {
    this.generation += 1
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.polling = false
  }

  /**
   * Request one phone verification challenge.
   * @param request - desired Handle and verification phone number.
   * @returns challenge retry metadata or one display-safe failure.
   */
  async sendRegistrationOtp(request: AwikiRegistrationOtpRequest): Promise<AwikiActionResult<AwikiRegistrationOtpResult>> {
    return this.withPending('发送验证码', () => call(() => this.remote.sendRegistrationOtp(request)))
  }

  /**
   * Register the deployment identity and populate the initial conversation list.
   * @param request - verified Handle, phone number, and one-time code.
   * @returns the registered public identity or one display-safe failure.
   */
  async registerIdentity(request: AwikiRegistrationRequest): Promise<AwikiActionResult<AwikiIdentity>> {
    const generation = this.generation
    const result = await this.withPending('注册身份', () => call(() => this.remote.registerIdentity(request)))
    if (!result.ok) return result
    if (!this.current(generation)) return result
    this.publish({ ...this.view, identity: result.value, error: null })
    await this.refreshConversations(generation)
    return result
  }

  /**
   * Load another page of the conversation roster.
   * @returns successful pagination or one display-safe failure.
   */
  async loadMoreConversations(): Promise<AwikiActionResult> {
    const generation = this.generation
    const result = await this.withPending('加载更多会话', () => call(() => this.remote.listConversations(
      this.conversationsCursor === undefined ? {} : { cursor: this.conversationsCursor },
    )))
    if (!result.ok) return result
    if (!this.current(generation)) return { ok: true, value: undefined }
    this.conversationsCursor = result.value.nextCursor
    this.publish({
      ...this.view,
      conversations: appendUnique(this.view.conversations, result.value.items, value => value.id),
      conversationsHasMore: result.value.hasMore && result.value.nextCursor !== undefined,
    })
    return { ok: true, value: undefined }
  }

  /**
   * Select a conversation and load its newest history page.
   * @param conversationId - selected conversation, or `null` to return to the roster.
   * @returns successful selection or one display-safe history failure.
   */
  async selectConversation(conversationId: AwikiConversationId | null): Promise<AwikiActionResult> {
    this.historyCursor = undefined
    this.publish({ ...this.view, selectedConversationId: conversationId, messages: [], historyHasMore: false, error: null })
    if (conversationId === null) return { ok: true, value: undefined }
    return this.loadHistory(false)
  }

  /**
   * Load one older history page before the currently rendered messages.
   * @returns successful pagination or one display-safe failure.
   */
  loadOlderHistory(): Promise<AwikiActionResult> {
    return this.loadHistory(true)
  }

  /**
   * Send one text message to the selected direct or group conversation.
   * @param text - non-empty text prepared by the composer.
   * @returns successful delivery or one display-safe failure.
   */
  async sendText(text: string): Promise<AwikiActionResult> {
    const conversation = this.selectedConversation()
    if (conversation === undefined) return this.fail('请先选择会话')
    const conversationId = conversation.id
    const generation = this.generation
    const result = await this.withPending('发送消息', () => call(() => this.remote.sendText({
      target: targetOf(conversation), text, idempotencyKey: crypto.randomUUID(),
    })))
    if (!result.ok) return result
    if (!this.current(generation) || this.view.selectedConversationId !== conversationId) {
      return { ok: true, value: undefined }
    }
    this.appendMessage(result.value)
    return { ok: true, value: undefined }
  }

  /**
   * Send one already-read browser file without retaining its bytes in the view.
   * @param file - JSON-safe file name, MIME type, base64 bytes, and optional caption.
   * @returns successful delivery or one display-safe failure.
   */
  async sendAttachment(file: {
    readonly fileName: string
    readonly mimeType: string
    readonly bytesBase64: string
    readonly caption?: string
  }): Promise<AwikiActionResult> {
    const conversation = this.selectedConversation()
    if (conversation === undefined) return this.fail('请先选择会话')
    const conversationId = conversation.id
    const generation = this.generation
    const request: AwikiSendAttachmentRequest = {
      target: targetOf(conversation),
      fileName: file.fileName,
      mimeType: file.mimeType,
      bytesBase64: file.bytesBase64,
      ...(file.caption === undefined ? {} : { caption: file.caption }),
      idempotencyKey: crypto.randomUUID(),
    }
    const result = await this.withPending('发送附件', () => call(() => this.remote.sendAttachment(request)))
    if (!result.ok) return result
    if (!this.current(generation) || this.view.selectedConversationId !== conversationId) {
      return { ok: true, value: undefined }
    }
    this.appendMessage(result.value)
    return { ok: true, value: undefined }
  }

  /**
   * Download verified attachment bytes without publishing them into controller state.
   * @param messageId - message that grants access to the attachment.
   * @param attachmentId - attachment selected from that message.
   * @returns verified attachment metadata and bytes, or one display-safe failure.
   */
  async downloadAttachment(
    messageId: AwikiMessageId,
    attachmentId: AwikiAttachmentId,
  ): Promise<AwikiActionResult<AwikiDownloadedAttachment>> {
    if (this.disposed) return { ok: false, error: 'AWiki 插件已卸载' }
    const generation = this.generation
    const result = await call(() => this.remote.downloadAttachment({ attachmentId, messageId }))
    return this.current(generation) ? result : { ok: false, error: 'AWiki 已关闭' }
  }

  /** Stop timers, invalidate work, and drop subscribers during HMR unload. */
  dispose(): void {
    this.disposed = true
    this.close()
    this.listeners.clear()
  }

  private async refreshConversations(generation: number): Promise<AwikiActionResult> {
    const result = await call(() => this.remote.listConversations({}))
    if (!this.current(generation)) return { ok: true, value: undefined }
    if (!result.ok) return this.fail(result.error)
    const firstPage = this.view.conversations.length === 0
    if (firstPage) this.conversationsCursor = result.value.nextCursor
    this.publish({
      ...this.view,
      conversations: firstPage
        ? result.value.items
        : appendUnique(result.value.items, this.view.conversations, value => value.id),
      conversationsHasMore: firstPage
        ? result.value.hasMore && result.value.nextCursor !== undefined
        : this.view.conversationsHasMore,
      error: null,
    })
    return { ok: true, value: undefined }
  }

  private async loadHistory(older: boolean): Promise<AwikiActionResult> {
    const conversationId = this.view.selectedConversationId
    if (conversationId === null) return this.fail('请先选择会话')
    const generation = this.generation
    const request: AwikiHistoryRequest = {
      conversationId,
      ...(older && this.historyCursor !== undefined ? { cursor: this.historyCursor } : {}),
    }
    const result = await this.withPending(older ? '加载更早消息' : '加载消息', () => call(() => this.remote.getHistory(request)))
    if (!result.ok) return result
    if (!this.current(generation)) return { ok: true, value: undefined }
    if (this.view.selectedConversationId !== conversationId) return { ok: true, value: undefined }
    this.historyCursor = result.value.nextCursor
    this.publish({
      ...this.view,
      // SDK pages are chronological. A continuation page contains older
      // messages, so it is prepended to the already rendered chronological tail.
      messages: older
        ? prependUnique(this.view.messages, result.value.items, value => value.id)
        : result.value.items,
      historyHasMore: result.value.hasMore && result.value.nextCursor !== undefined,
    })
    return { ok: true, value: undefined }
  }

  private async poll(generation: number): Promise<void> {
    if (this.polling || !this.current(generation) || this.view.identity === null) return
    this.polling = true
    try {
      await this.refreshConversations(generation)
      const selected = this.view.selectedConversationId
      if (selected === null || !this.current(generation)) return
      const result = await call(() => this.remote.getHistory({ conversationId: selected }))
      if (!this.current(generation) || !result.ok || this.view.selectedConversationId !== selected) return
      this.publish({
        ...this.view,
        messages: appendUnique(this.view.messages, result.value.items, value => value.id),
      })
    } finally {
      this.polling = false
    }
  }

  private async withPending<Value>(label: string, operation: () => Promise<AwikiActionResult<Value>>): Promise<AwikiActionResult<Value>> {
    if (this.disposed) return { ok: false, error: 'AWiki 插件已卸载' }
    const generation = this.generation
    this.publish({ ...this.view, pending: label, error: null })
    const result = await operation()
    if (!this.current(generation)) return result
    this.publish({ ...this.view, pending: null, error: result.ok ? null : result.error })
    return result
  }

  private appendMessage(message: AwikiMessage): void {
    this.publish({
      ...this.view,
      messages: appendUnique(this.view.messages, [message], value => value.id),
      error: null,
    })
  }

  private selectedConversation(): AwikiConversation | undefined {
    const selected = this.view.selectedConversationId
    return selected === null ? undefined : this.view.conversations.find(value => value.id === selected)
  }

  private fail(error: string): AwikiActionResult<never> {
    this.publish({ ...this.view, status: this.view.status === 'loading' ? 'error' : this.view.status, pending: null, error })
    return { ok: false, error }
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private publish(view: AwikiView): void {
    /* v8 ignore next -- every asynchronous and public mutation path checks disposal before publishing. */
    if (this.disposed) return
    this.view = Object.freeze(view)
    for (const listener of [...this.listeners]) listener()
  }
}
