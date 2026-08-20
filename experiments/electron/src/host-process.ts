/** Owned DSH Web Host subprocess lifecycle for the Electron shell. */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import type { Readable } from 'node:stream'

const READY_PREFIX = 'dsh web: '
const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_STOP_TIMEOUT_MS = 10_000
const DIAGNOSTIC_TAIL_BYTES = 16 * 1024

/** Remove common credentials before Host output is retained or shown to a user. */
export function redactHostDiagnosticLine(line: string): string {
  return line
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/giu, '$1:[REDACTED]')
    .replace(/\b(Bearer)\s+[^\s,;]+/giu, '$1 [REDACTED]')
    .replace(/\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password)\s*([:=])\s*[^\s,;&#]+/giu, '$1$2[REDACTED]')
    .replace(/([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password)=)[^&#\s]+/giu, '$1[REDACTED]')
}

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
  /** Resolves after the child and its stdio close; spawn failures reject. */
  readonly exited: Promise<WebHostExit>

  private stopPromise: Promise<void> | undefined
  private readonly stopTimeoutMs: number
  private diagnosticOutput = ''

  private constructor(
    private readonly child: ChildProcessByStdio<null, Readable, Readable>,
    options: WebHostLaunchOptions,
  ) {
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })
    stderr.on('line', (line) => {
      const safeLine = this.appendDiagnostic('stderr', line)
      options.onStderrLine?.(safeLine)
    })
    const stdoutClosed = new Promise<void>((resolve) => { stdout.once('close', resolve) })
    const stderrClosed = new Promise<void>((resolve) => { stderr.once('close', resolve) })
    const processClosed = new Promise<WebHostExit>((resolve, reject) => {
      child.once('close', (code, signal) => { resolve({ code, signal }) })
      child.once('error', reject)
    })
    // ChildProcess `close` and readline's final `line`/`close` delivery are
    // distinct events. Recovery must not read diagnostics until all drain.
    this.exited = processClosed.then(async (exit) => {
      await Promise.all([stdoutClosed, stderrClosed])
      return exit
    })
    void this.exited.catch(() => {})
    this.ready = this.observeReadiness(options, stdout)
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

  /** Return the bounded, redacted output tail captured across the full child lifetime. */
  diagnostics(): string {
    return this.diagnosticOutput.trim()
  }

  private appendDiagnostic(source: 'stdout' | 'stderr', line: string): string {
    const safeLine = redactHostDiagnosticLine(line)
    this.diagnosticOutput = `${this.diagnosticOutput}[${source}] ${safeLine}\n`.slice(-DIAGNOSTIC_TAIL_BYTES)
    return safeLine
  }

  private observeReadiness(options: WebHostLaunchOptions, stdout: Interface): Promise<string> {
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
        const safeLine = this.appendDiagnostic('stdout', line)
        options.onStdoutLine?.(safeLine)
        const url = parseWebHostReadyUrl(line)
        if (url !== undefined) finish(() => { resolve(url) })
      })
      void this.exited.then(
        ({ code, signal }) => {
          finish(() => {
            const detail = this.diagnostics()
            reject(new Error(
              `dsh Electron: Web Host exited before readiness (code=${String(code)}, signal=${String(signal)})`
              + (detail.length === 0 ? '' : `\n${detail}`),
            ))
          })
        },
        (error: unknown) => {
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
