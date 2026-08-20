/** Bounded recovery policy and local fallback page for the Electron-owned Host. */

const DEFAULT_RESTART_WINDOW_MS = 60_000
const DEFAULT_RESTART_DELAYS_MS = [300, 1_000] as const

/** Allow a small burst of automatic restarts, then require an explicit user decision. */
export class BoundedHostRestartPolicy {
  private attempts: number[] = []

  constructor(
    private readonly delaysMs: readonly number[] = DEFAULT_RESTART_DELAYS_MS,
    private readonly windowMs = DEFAULT_RESTART_WINDOW_MS,
  ) {}

  /** Return the next backoff delay, or null after the rolling-window budget is exhausted. */
  nextDelay(now = Date.now()): number | null {
    this.attempts = this.attempts.filter(attempt => now - attempt < this.windowMs)
    const delay = this.delaysMs[this.attempts.length]
    if (delay === undefined) return null
    this.attempts.push(now)
    return delay
  }
}

/** Build a script-free local page that survives while the loopback Host is unavailable. */
export function hostRecoveryPageUrl(state: 'restarting' | 'stopped'): string {
  const restarting = state === 'restarting'
  const title = restarting ? '正在恢复本地服务' : '本地服务已停止'
  const detail = restarting
    ? 'DeepSeek Harness 正在重新连接本地 Host，请稍候。'
    : '你可以在系统提示中重新启动 Host，当前窗口和本地数据不会被关闭或清除。'
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#f7f7f5;color:#202124;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.state{width:min(420px,calc(100% - 48px));text-align:center}.spinner{width:26px;height:26px;margin:0 auto 18px;border:3px solid #d8d9d4;border-top-color:#176b4d;border-radius:50%;${restarting ? 'animation:spin .9s linear infinite' : ''}}h1{margin:0;font-size:20px;line-height:30px;letter-spacing:0}p{margin:8px 0 0;color:#656863;font-size:13px;line-height:21px;letter-spacing:0}@keyframes spin{to{transform:rotate(360deg)}}</style><main class="state"><div class="spinner" aria-hidden="true"></div><h1>${title}</h1><p>${detail}</p></main></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
