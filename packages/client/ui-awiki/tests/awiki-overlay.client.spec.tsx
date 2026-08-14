// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AwikiMessage } from '@deepseek-ai/dsh-awiki/types'
import { AwikiController } from '../src/client/controller.ts'
import { AwikiOverlay } from '../src/client/AwikiOverlay.tsx'
import { createAwikiOverlayStore } from '../src/client/store.ts'
import type { AwikiOverlayProps } from '../src/client/slots.ts'
import { attachmentMessage, direct, fakeRemote, group } from './helpers.client.ts'

vi.mock('../src/client/file.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/file.ts')>(),
  saveDownloadedAttachment: vi.fn(),
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Render the pure component with real observable/controller/store products. */
function renderOverlay(options: Parameters<typeof fakeRemote>[0] & { registered?: boolean } = {}) {
  const { registered, ...remoteOptions } = options
  const identityOption = registered === false
    ? { identity: null }
    : remoteOptions.identity === undefined ? {} : { identity: remoteOptions.identity }
  const fake = fakeRemote({ ...remoteOptions, ...identityOption })
  const controller = new AwikiController(fake.remote)
  const instance = createAwikiOverlayStore().create()
  const useStore: AwikiOverlayProps['useStore'] = selector =>
    useSyncExternalStore(
      (listener: () => void) => instance.subscribe(listener),
      () => selector(instance.getSnapshot()),
    )
  const useAwiki: AwikiOverlayProps['useAwiki'] = selector =>
    useSyncExternalStore(
      (listener: () => void) => controller.subscribe(listener),
      () => selector(controller.getSnapshot()),
    )
  const props: AwikiOverlayProps = {
    useStore,
    actions: instance.actions,
    useAwiki,
    open: () => controller.open(),
    close: () => { controller.close() },
    sendRegistrationOtp: request => controller.sendRegistrationOtp(request),
    registerIdentity: request => controller.registerIdentity(request),
    loadMoreConversations: () => controller.loadMoreConversations(),
    selectConversation: id => controller.selectConversation(id),
    loadOlderHistory: () => controller.loadOlderHistory(),
    sendText: text => controller.sendText(text),
    sendAttachment: file => controller.sendAttachment(file),
    downloadAttachment: (messageId, attachmentId) => controller.downloadAttachment(messageId, attachmentId),
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
  }
  render(<AwikiOverlay {...props} />)
  return { fake, controller, instance }
}

describe('AwikiOverlay', () => {
  it('opens the drawer, shows identity, and renders direct/group navigation', async () => {
    renderOverlay()
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    expect(await screen.findByRole('dialog', { name: 'AWiki' })).toBeTruthy()
    expect(await screen.findByText('@alice')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Bob/ }).textContent).toContain('私聊')
  })

  it('collects Handle and phone before OTP, then completes registration', async () => {
    const b = renderOverlay({ registered: false })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    await screen.findByText('注册 AWiki 身份')
    fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800000000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(await screen.findByText(/验证码已发送/)).toBeTruthy()
    expect(b.fake.calls.find(call => call.method === 'sendRegistrationOtp')?.request).toEqual({ handle: 'alice', phone: '13800000000' })

    fireEvent.click(screen.getByRole('button', { name: '重新获取验证码' }))
    expect(screen.queryByLabelText('验证码')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '注册身份' }))
    expect(await screen.findByText('@alice')).toBeTruthy()
  })

  it('loads history, sends text, and reads one selected attachment', async () => {
    const b = renderOverlay()
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    fireEvent.click(await screen.findByRole('button', { name: /Bob/ }))
    expect(await screen.findByText('你好')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('输入消息'), { target: { value: '收到' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => { expect(b.fake.calls.some(call => call.method === 'sendText')).toBe(true) })
    expect(await screen.findByText('收到')).toBeTruthy()

    const picker = screen.getByLabelText('选择一个附件')
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' })
    fireEvent.change(picker, { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: '发送附件' }))
    await waitFor(() => { expect(b.fake.calls.some(call => call.method === 'sendAttachment')).toBe(true) })

    const untyped = new File(['abc'], 'unknown.bin')
    fireEvent.change(picker, { target: { files: [untyped] } })
    fireEvent.change(await screen.findByPlaceholderText('附件说明（可选）'), { target: { value: '说明' } })
    fireEvent.click(screen.getByRole('button', { name: '发送附件' }))
    await waitFor(() => {
      expect(b.fake.calls.filter(call => call.method === 'sendAttachment').at(-1)?.request).toMatchObject({
        mimeType: 'application/octet-stream',
        caption: '说明',
      })
    })

    fireEvent.change(picker, { target: { files: null } })
    expect(screen.queryByPlaceholderText('附件说明（可选）')).toBeNull()
  })

  it('rejects an oversized attachment before reading or calling the Host', async () => {
    const b = renderOverlay({ config: { pollIntervalMs: 1000, attachmentMaxBytes: 2 } })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    fireEvent.click(await screen.findByRole('button', { name: /Bob/ }))
    const file = new File(['abc'], 'too-large.txt', { type: 'text/plain' })
    const arrayBuffer = vi.fn()
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer })
    fireEvent.change(screen.getByLabelText('选择一个附件'), { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: '发送附件' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '附件不能超过 2 字节。')
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(b.fake.calls.some(call => call.method === 'sendAttachment')).toBe(false)
  })

  it('downloads an attachment with its containing message identity', async () => {
    const b = renderOverlay({ history: [attachmentMessage] })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    fireEvent.click(await screen.findByRole('button', { name: /Bob/ }))
    fireEvent.click(await screen.findByRole('button', { name: /a.txt/ }))
    await waitFor(() => {
      expect(b.fake.calls.find(call => call.method === 'downloadAttachment')?.request).toEqual({
        messageId: attachmentMessage.id,
        attachmentId: attachmentMessage.content.kind === 'attachment'
          ? attachmentMessage.content.attachment.id
          : undefined,
      })
    })
  })

  it('shows attachment captions, DID fallback, outgoing state, and download failures', async () => {
    if (attachmentMessage.content.kind !== 'attachment') throw new Error('attachment fixture must carry an attachment')
    const captioned: AwikiMessage = {
      ...attachmentMessage,
      content: { ...attachmentMessage.content, caption: '附件说明' },
    }
    delete (captioned as { senderHandle?: unknown }).senderHandle
    const outgoing: AwikiMessage = {
      ...attachmentMessage,
      id: 'outgoing-file' as never,
      outgoing: true,
      content: {
        kind: 'attachment',
        attachment: { ...attachmentMessage.content.attachment, id: 'a2' as never, fileName: 'b.txt' },
      },
    }
    const b = renderOverlay({ history: [captioned, outgoing] })
    b.fake.remote.downloadAttachment = () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'forbidden', message: '不能下载' } },
    })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    fireEvent.click(await screen.findByRole('button', { name: /Bob/ }))
    expect(await screen.findByText('附件说明')).toBeTruthy()
    expect(screen.getByText('did:wba:bob')).toBeTruthy()
    expect(screen.getByText('我')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /a.txt/ }))
    expect(await screen.findByText('forbidden：不能下载')).toBeTruthy()
  })

  it('renders group/empty navigation and invokes both pagination controls', async () => {
    const noActivity = { ...direct }
    delete (noActivity as { lastMessageAt?: unknown }).lastMessageAt
    const b = renderOverlay({
      conversations: [noActivity, group],
      conversationsHasMore: true,
      conversationsCursor: 'more-conversations' as never,
      history: [],
      historyHasMore: true,
      historyCursor: 'older-history' as never,
    })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    fireEvent.click(await screen.findByRole('button', { name: '加载更多会话' }))
    await waitFor(() => {
      expect(b.fake.calls.filter(call => call.method === 'listConversations')).toHaveLength(2)
    })
    fireEvent.click(screen.getByRole('button', { name: /Harness Team/ }))
    expect((await screen.findAllByText('群聊')).length).toBeGreaterThan(0)
    expect(await screen.findByText('暂无消息。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }))
    await waitFor(() => {
      expect(b.fake.calls.filter(call => call.method === 'getHistory')).toHaveLength(2)
    })
    fireEvent.click(screen.getByRole('button', { name: '返回会话列表' }))
    expect(await screen.findByText('选择一个私聊或群聊查看消息。')).toBeTruthy()

    b.instance.actions.close()
    const empty = renderOverlay({ conversations: [] })
    fireEvent.click(screen.getAllByRole('button', { name: '打开 AWiki' }).at(-1)!)
    expect(await screen.findByText('还没有可用的私聊或群聊。')).toBeTruthy()
    empty.instance.actions.close()
  })

  it('keeps registration and composer drafts after business failures', async () => {
    const registration = renderOverlay({ registered: false })
    registration.fake.remote.sendRegistrationOtp = () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'rate-limited', message: '稍后重试' } },
    })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    fireEvent.change(await screen.findByLabelText('Handle'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800000000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(await screen.findByText('rate-limited：稍后重试')).toBeTruthy()
    expect(screen.queryByLabelText('验证码')).toBeNull()
    registration.fake.remote.sendRegistrationOtp = () => Promise.resolve({
      ok: true,
      value: { ok: true, value: { retryAfterSeconds: 60, retryAt: new Date(Date.now() + 60_000).toISOString() } },
    })
    registration.fake.remote.registerIdentity = () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'invalid-otp', message: '验证码错误' } },
    })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '注册身份' }))
    expect(await screen.findByText('invalid-otp：验证码错误')).toBeTruthy()
    expect(screen.getByLabelText('验证码')).toHaveProperty('value', '000000')
    registration.instance.actions.close()

    const chat = renderOverlay()
    chat.fake.remote.sendText = () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'network', message: '发送失败' } },
    })
    chat.fake.remote.sendAttachment = () => Promise.resolve({
      ok: true,
      value: { ok: false, error: { code: 'network', message: '附件失败' } },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '打开 AWiki' }).at(-1)!)
    fireEvent.click(await screen.findByRole('button', { name: /Bob/ }))
    await screen.findByText('你好')
    const composer = screen.getByPlaceholderText('输入消息')
    fireEvent.change(composer, { target: { value: '保留' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('network：发送失败')).toBeTruthy()
    expect((composer as HTMLTextAreaElement).value).toBe('保留')
    const picker = screen.getByLabelText('选择一个附件')
    fireEvent.change(picker, { target: { files: [new File(['x'], 'failed.txt')] } })
    fireEvent.click(await screen.findByRole('button', { name: '发送附件' }))
    expect(await screen.findByText('network：附件失败')).toBeTruthy()
    expect(await screen.findByText('failed.txt')).toBeTruthy()
  })

  it('shows loading and pending states, refreshes, retries, and closes on Escape', async () => {
    const loading = renderOverlay()
    let settleConfig: (() => void) | undefined
    loading.fake.remote.getConfig = () => new Promise((resolve) => {
      settleConfig = () => {
        resolve({ ok: true, value: { ok: true, value: { pollIntervalMs: 1000, attachmentMaxBytes: 1024 } } })
      }
    })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    expect(await screen.findByText('正在连接 AWiki…')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    settleConfig?.()
    expect(await screen.findByText('@alice')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新 AWiki' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stops polling on close and offers refresh after a Host config failure', async () => {
    const b = renderOverlay()
    b.fake.remote.getConfig = () => Promise.resolve({ ok: false, error: { code: 'offline', message: '不可用', details: {} } })
    fireEvent.click(screen.getByRole('button', { name: '打开 AWiki' }))
    expect(await screen.findByText(/连接 AWiki Host 失败/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新 AWiki' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭 AWiki' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
