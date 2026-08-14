/** AWiki trigger, identity registration, and direct/group messaging drawer. */

import { useEffect, useId, useRef, useState } from 'react'
import {
  IconChevronLeftOutline14,
  IconCloseOutline16,
  IconDownloadOutline16,
  IconGlobeOutline14,
  IconRefreshOutline16,
  IconSendOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AwikiConversation, AwikiIdentity, AwikiMessage } from '@deepseek-ai/dsh-awiki/types'
import type { AwikiView } from './controller.ts'
import { fileToBase64, saveDownloadedAttachment } from './file.ts'
import type { AwikiOverlayProps } from './slots.ts'
import css from './AwikiOverlay.module.css'

/** Format one Host timestamp for compact local display. */
function time(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

/** Render the identity registration form and its OTP challenge transition. */
function Registration(props: Pick<AwikiOverlayProps, 'sendRegistrationOtp' | 'registerIdentity'> & { pending: boolean }) {
  const [phone, setPhone] = useState('')
  const [handle, setHandle] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const requestOtp = async () => {
    const result = await props.sendRegistrationOtp({ handle: handle.trim(), phone: phone.trim() })
    if (!result.ok) return
    setOtpSent(true)
    setNotice(`验证码已发送；${result.value.retryAfterSeconds} 秒后可重新获取。`)
  }
  const register = async () => {
    /* v8 ignore next -- the registration action is rendered only after an OTP challenge starts. */
    if (!otpSent) return
    const result = await props.registerIdentity({
      phone: phone.trim(), handle: handle.trim(), otp: otp.trim(),
    })
    if (!result.ok) return
    setNotice(null)
  }

  return (
    <div className={css.registration}>
      <div className={css.registrationIcon}><IconUserOutline16 size={24} /></div>
      <h3>注册 AWiki 身份</h3>
      <p>该身份由当前 Harness 部署中的全部 Agent 共同使用。</p>
      <label>Handle<input value={handle} onChange={(event) => { setHandle(event.target.value) }} autoComplete="username" placeholder="例如 alice" /></label>
      <label>手机号<input value={phone} onChange={(event) => { setPhone(event.target.value) }} autoComplete="tel" /></label>
      {!otpSent ? (
        <button type="button" className={css.primary} disabled={props.pending || phone.trim() === '' || handle.trim() === ''} onClick={() => { void requestOtp() }}>
          获取验证码
        </button>
      ) : (
        <>
          <label>验证码<input value={otp} onChange={(event) => { setOtp(event.target.value) }} inputMode="numeric" autoComplete="one-time-code" /></label>
          <button type="button" className={css.primary} disabled={props.pending || handle.trim() === '' || otp.trim() === ''} onClick={() => { void register() }}>
            注册身份
          </button>
          <button type="button" className={css.linkButton} disabled={props.pending} onClick={() => { setOtpSent(false); setOtp(''); setNotice(null) }}>
            重新获取验证码
          </button>
        </>
      )}
      {notice !== null && <p className={css.notice} role="status">{notice}</p>}
    </div>
  )
}

/** Render one direct or group conversation row. */
function ConversationRow(props: { conversation: AwikiConversation; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={css.conversationRow} data-active={props.active || undefined} onClick={props.onSelect}>
      <span className={css.avatar}>{props.conversation.kind === 'direct' ? '私' : '群'}</span>
      <span className={css.conversationText}>
        <strong>{props.conversation.title}</strong>
        <small>{props.conversation.kind === 'direct' ? '私聊' : '群聊'}{props.conversation.lastMessageAt === undefined ? '' : ` · ${time(props.conversation.lastMessageAt)}`}</small>
      </span>
    </button>
  )
}

/** Render one AWiki message, including an attachment download action. */
function MessageRow(props: { message: AwikiMessage; download: AwikiOverlayProps['downloadAttachment'] }) {
  const [error, setError] = useState<string | null>(null)
  const download = async () => {
    /* v8 ignore next -- only attachment content renders the button that invokes this closure. */
    if (props.message.content.kind !== 'attachment') return
    const result = await props.download(props.message.id, props.message.content.attachment.id)
    if (!result.ok) { setError(result.error); return }
    saveDownloadedAttachment(result.value)
  }
  return (
    <div className={css.message} data-outgoing={props.message.outgoing || undefined}>
      <div className={css.messageMeta}>
        <span>{props.message.outgoing ? '我' : (props.message.senderHandle ?? props.message.senderDid)}</span>
        <time>{time(props.message.sentAt)}</time>
      </div>
      {props.message.content.kind === 'text' ? (
        <p>{props.message.content.text}</p>
      ) : (
        <>
          <button type="button" className={css.attachment} onClick={() => { void download() }}>
            <span>
              <strong>{props.message.content.attachment.fileName}</strong>
              <small>{props.message.content.attachment.size} 字节</small>
            </span>
            <IconDownloadOutline16 size={16} />
          </button>
          {props.message.content.caption !== undefined && <p className={css.caption}>{props.message.content.caption}</p>}
        </>
      )}
      {error !== null && <small className={css.inlineError}>{error}</small>}
    </div>
  )
}

/** Render the conversation roster, history, composer, and one-file picker. */
function Chat(props: AwikiOverlayProps & { view: AwikiView & { identity: AwikiIdentity } }) {
  const { view } = props
  const [text, setText] = useState('')
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const selected = view.conversations.find(value => value.id === view.selectedConversationId)
  const sendText = async () => {
    const draft = text.trim()
    /* v8 ignore next -- the only invocation control is disabled while the trimmed draft is empty. */
    if (draft === '') return
    const result = await props.sendText(draft)
    if (result.ok) setText('')
  }
  const sendFile = async () => {
    /* v8 ignore next -- the send-file control is mounted only while a file is selected. */
    if (file === null) return
    if (file.size > view.attachmentMaxBytes) {
      setFileError(`附件不能超过 ${view.attachmentMaxBytes} 字节。`)
      return
    }
    setFileError(null)
    const bytesBase64 = await fileToBase64(file)
    const result = await props.sendAttachment({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      bytesBase64,
      ...(caption.trim() === '' ? {} : { caption: caption.trim() }),
    })
    if (result.ok) {
      setFile(null)
      setCaption('')
      /* v8 ignore else -- the file control remains mounted while its selected-file action runs. */
      if (input.current !== null) input.current.value = ''
    }
  }

  return (
    <div className={css.chat}>
      <aside className={css.roster} data-hidden={selected !== undefined || undefined}>
        <div className={css.identityCard}>
          <strong>@{view.identity.handle}</strong>
          <small>{view.identity.did}</small>
          <span><i />可发送消息</span>
        </div>
        <div className={css.rosterTitle}>会话</div>
        <div className={css.conversationList}>
          {view.conversations.map(conversation => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === view.selectedConversationId}
              onSelect={() => { void props.selectConversation(conversation.id) }}
            />
          ))}
          {view.conversations.length === 0 && <p className={css.empty}>还没有可用的私聊或群聊。</p>}
        </div>
        {view.conversationsHasMore && <button type="button" className={css.more} onClick={() => { void props.loadMoreConversations() }}>加载更多会话</button>}
      </aside>
      <section className={css.thread} data-visible={selected !== undefined || undefined}>
        {selected === undefined ? (
          <div className={css.threadEmpty}><IconGlobeOutline14 size={28} /><p>选择一个私聊或群聊查看消息。</p></div>
        ) : (
          <>
            <header className={css.threadHeader}>
              <button type="button" className={css.back} aria-label="返回会话列表" onClick={() => { void props.selectConversation(null) }}><IconChevronLeftOutline14 /></button>
              <div><strong>{selected.title}</strong><small>{selected.kind === 'direct' ? '私聊' : '群聊'}</small></div>
            </header>
            <div className={css.history}>
              {view.historyHasMore && <button type="button" className={css.more} onClick={() => { void props.loadOlderHistory() }}>加载更早消息</button>}
              {view.messages.map(message => <MessageRow key={message.id} message={message} download={props.downloadAttachment} />)}
              {view.messages.length === 0 && <p className={css.empty}>暂无消息。</p>}
            </div>
            <div className={css.composer}>
              {file !== null && (
                <div className={css.fileDraft}>
                  <span>{file.name}</span>
                  <input value={caption} onChange={(event) => { setCaption(event.target.value) }} placeholder="附件说明（可选）" />
                  <button type="button" disabled={view.pending !== null} onClick={() => { void sendFile() }}>发送附件</button>
                </div>
              )}
              {fileError !== null && <small className={css.inlineError} role="alert">{fileError}</small>}
              <div className={css.composeRow}>
                <input ref={input} type="file" className={css.fileInput} aria-label="选择一个附件" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFileError(null) }} />
                <textarea value={text} onChange={(event) => { setText(event.target.value) }} placeholder="输入消息" rows={2} />
                <button type="button" className={css.send} aria-label="发送消息" disabled={view.pending !== null || text.trim() === ''} onClick={() => { void sendText() }}><IconSendOutline16 /></button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

/**
 * Render the frame-wide AWiki trigger and right-side drawer.
 * @param props - slot-derived runtime, store, and injected AWiki operations.
 * @returns the persistent trigger and the conditionally mounted drawer.
 */
export function AwikiOverlay(props: AwikiOverlayProps) {
  const open = props.useStore(state => state.open)
  const view = props.useAwiki(state => state)
  const titleId = useId()

  useEffect(() => {
    if (!open) { props.close(); return }
    void props.open()
    return props.close
  }, [open, props.close, props.open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') props.actions.close() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, props.actions])

  return (
    <>
      <button type="button" className={css.trigger} aria-label="打开 AWiki" aria-expanded={open} aria-haspopup="dialog" onClick={props.actions.toggle}>
        <IconGlobeOutline14 size={18} /><span>AWiki</span>
      </button>
      {open && (
        <div className={css.drawer} role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <header className={css.drawerHeader}>
            <div><IconGlobeOutline14 size={18} /><h2 id={titleId}>AWiki</h2></div>
            <button type="button" aria-label="刷新 AWiki" disabled={view.pending !== null} onClick={() => { void props.open() }}><IconRefreshOutline16 /></button>
            <button type="button" aria-label="关闭 AWiki" onClick={props.actions.close}><IconCloseOutline16 /></button>
          </header>
          {view.status === 'loading' && <div className={css.centerState} role="status">正在连接 AWiki…</div>}
          {view.status === 'error' && <div className={css.centerState}><p>{view.error}</p><button type="button" className={css.primary} onClick={() => { void props.open() }}>重试</button></div>}
          {view.status === 'ready' && view.identity === null && <Registration {...props} pending={view.pending !== null} />}
          {view.status === 'ready' && view.identity !== null && <Chat {...props} view={{ ...view, identity: view.identity }} />}
          {view.error !== null && view.status !== 'error' && <div className={css.error} role="alert">{view.error}</div>}
          {view.pending !== null && <div className={css.pending} role="status">{view.pending}…</div>}
        </div>
      )}
    </>
  )
}
