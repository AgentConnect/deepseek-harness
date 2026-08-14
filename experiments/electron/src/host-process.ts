/** Owned DSH Web Host subprocess lifecycle for the Electron shell. */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'

const READY_PREFIX = 'dsh web: '
const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_STOP_TIMEOUT_MS = 10_000
const STDERR_TAIL_BYTES = 16 * 1024

/** Process exit facts observed after the DSH Host reaches quiescence. */
export interface WebHostExit {
  /** Numeric process exit status, or null for signal termination. */
  code: number | null
  /** Terminating signal, or null for ordinary exit. */
  signal: NodeJS.Signals | null
}

/** Inputs for launching the existing `dsh web` application. */
export interface WebHostLaunchOptions {
  /** Node-compatible executable. */
  command: string
  /** Complete CLI argv, including the DSH built bin. */
  args: readonly string[]
  /** Workspace root inherited by sessions created from the shell. */
  cwd: string
  /** Child environment. */
  env: NodeJS.ProcessEnv
  /** Maximum wait for the CLI readiness line. */
  readyTimeoutMs?: number
  /** Grace period before shutdown escalates from SIGTERM to SIGKILL. */
  stopTimeoutMs?: number
  /** Optional stdout observer for application logging. */
  onStdoutLine?: (line: string) => void
  /** Optional stderr observer for application logging. */
  onStderrLine?: (line: string) => void
}

/**
 * Extract the canonical loopback URL from the CLI readiness line.
 * @param line - one complete stdout line.
 * @returns the URL when it is an HTTP 127.0.0.1 authority with an explicit port.
 */
export function parseWebHostReadyUrl(line: string): string | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const token = line.slice(READY_PREFIX.length).split(/\s/u, 1)[0]
  if (token === undefined || token.length === 0) return undefined
  try {
    const url = new URL(token)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port.length === 0) return undefined
    if (url.username.length > 0 || url.password.length > 0 || url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** Owned DSH Host child with readiness and quiescent shutdown promises. */
export class WebHostProcess {
  /** Resolves with the validated loopback URL after the CLI reports readiness. */
  readonly ready: Promise<string>
  /** Resolves when the child exits; spawn failures reject. */
  readonly exited: Promise<WebHostExit>

  private stopPromise: Promise<void> | undefined
  private readonly stopTimeoutMs: number

  private constructor(
    private readonly child: ChildProcessByStdio<null, Readable, Readable>,
    options: WebHostLaunchOptions,
  ) {
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
    this.exited = new Promise<WebHostExit>((resolve, reject) => {
      child.once('exit', (code, signal) => { resolve({ code, signal }) })
      child.once('error', reject)
    })
    void this.exited.catch(() => {})
    this.ready = this.observeReadiness(options)
  }

  /**
   * Spawn the existing DSH CLI as the Electron shell's owned Host.
   * @param options - executable, argv, environment, workspace, and timeouts.
   * @returns the owned process handle.
   */
  static launch(options: WebHostLaunchOptions): WebHostProcess {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return new WebHostProcess(child, options)
  }

  /**
   * Request graceful Host disposal and wait for process exit.
   * @returns resolution after the child reaches quiescence.
   */
  stop(): Promise<void> {
    this.stopPromise ??= this.stopOnce()
    return this.stopPromise
  }

  private observeReadiness(options: WebHostLaunchOptions): Promise<string> {
    const stdout = createInterface({ input: this.child.stdout })
    const stderr = createInterface({ input: this.child.stderr })
    let stderrTail = ''

    stderr.on('line', (line) => {
      options.onStderrLine?.(line)
      stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL_BYTES)
    })

    return new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (action: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        action()
      }
      const timeout = setTimeout(() => {
        finish(() => { reject(new Error('dsh Electron: timed out waiting for the Web Host readiness line')) })
      }, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
      timeout.unref()

      stdout.on('line', (line) => {
        options.onStdoutLine?.(line)
        const url = parseWebHostReadyUrl(line)
        if (url !== undefined) finish(() => { resolve(url) })
      })
      void this.exited.then(
        ({ code, signal }) => {
          stdout.close()
          stderr.close()
          finish(() => {
            const detail = stderrTail.trim()
            reject(new Error(
              `dsh Electron: Web Host exited before readiness (code=${String(code)}, signal=${String(signal)})`
              + (detail.length === 0 ? '' : `\n${detail}`),
            ))
          })
        },
        (error: unknown) => {
          stdout.close()
          stderr.close()
          finish(() => { reject(error instanceof Error ? error : new Error(String(error))) })
        },
      )
    })
  }

  private async stopOnce(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      await this.exited
      return
    }
    this.child.kill('SIGTERM')
    let stopTimer: NodeJS.Timeout | undefined
    const stoppedGracefully = await Promise.race([
      this.exited.then(() => true),
      new Promise<false>((resolve) => {
        stopTimer = setTimeout(() => { resolve(false) }, this.stopTimeoutMs)
        stopTimer.unref()
      }),
    ])
    if (stopTimer !== undefined) clearTimeout(stopTimer)
    if (!stoppedGracefully) this.child.kill('SIGKILL')
    await this.exited
  }
}
