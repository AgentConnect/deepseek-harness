/** Electron desktop shell over the existing loopback DSH Web application. */

import { app, BrowserWindow, clipboard, dialog, shell, type MessageBoxOptions } from 'electron'
import { BoundedHostRestartPolicy, hostRecoveryPageUrl } from './host-recovery.ts'
import { WebHostProcess, type WebHostExit, type WebHostLaunchOptions } from './host-process.ts'
import { ensurePackagedRuntime } from './runtime-install.ts'
import { configureElectronStateRoot, resolveHostLaunch, resolveWorkspaceRoot } from './runtime.ts'

configureElectronStateRoot(process.env.DSH_ELECTRON_USER_DATA, app)

let host: WebHostProcess | undefined
let readyUrl: string | undefined
let allowedHostOrigin: string | undefined
let window: BrowserWindow | undefined
let launchOptions: WebHostLaunchOptions | undefined
let shutdownStarted = false
let allowQuit = false
let recoveryPromise: Promise<void> | undefined
let queuedRecoveryFailure: string | undefined
const restartPolicy = new BoundedHostRestartPolicy()

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function exitMessage(exit: WebHostExit, diagnostics: string): string {
  const summary = `The local Host exited unexpectedly (code=${String(exit.code)}, signal=${String(exit.signal)}).`
  return diagnostics.length === 0 ? summary : `${summary}\n\n${diagnostics}`
}

async function createWindow(): Promise<BrowserWindow> {
  const created = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DeepSeek Harness',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  window = created
  created.once('ready-to-show', () => { if (!created.isDestroyed()) created.show() })
  created.on('closed', () => { if (window === created) window = undefined })
  created.webContents.on('will-navigate', (event, target) => {
    try {
      if (allowedHostOrigin === undefined || new URL(target).origin !== allowedHostOrigin) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  created.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const parsed = new URL(target)
      if (parsed.protocol === 'https:' && parsed.username.length === 0 && parsed.password.length === 0) {
        void shell.openExternal(parsed.href).catch((error: unknown) => {
          console.error('dsh Electron: could not open external URL:', error)
        })
      }
    } catch {
      // Malformed and non-HTTPS targets stay denied.
    }
    return { action: 'deny' }
  })
  return created
}

async function loadHostUrl(url: string): Promise<void> {
  const target = window ?? await createWindow()
  allowedHostOrigin = new URL(url).origin
  await target.loadURL(url)
}

async function showRecoveryPage(state: 'restarting' | 'stopped'): Promise<void> {
  const target = window
  if (target === undefined || target.isDestroyed()) return
  allowedHostOrigin = undefined
  await target.loadURL(hostRecoveryPageUrl(state))
}

async function launchCandidate(): Promise<{ process: WebHostProcess; url: string }> {
  if (launchOptions === undefined) throw new Error('dsh Electron: Host launch configuration is unavailable')
  const process = WebHostProcess.launch(launchOptions)
  try {
    return { process, url: await process.ready }
  } catch (error: unknown) {
    const diagnostics = process.diagnostics()
    await process.stop().catch(() => undefined)
    const message = errorMessage(error)
    throw new Error(diagnostics.length === 0 || message.includes(diagnostics) ? message : `${message}\n\n${diagnostics}`)
  }
}

function observeHost(process: WebHostProcess): void {
  void process.exited.then((exit) => {
    if (shutdownStarted || allowQuit || host !== process) return
    host = undefined
    readyUrl = undefined
    scheduleRecovery(exitMessage(exit, process.diagnostics()))
  }, (error: unknown) => {
    if (shutdownStarted || allowQuit || host !== process) return
    host = undefined
    readyUrl = undefined
    const diagnostics = process.diagnostics()
    scheduleRecovery(diagnostics.length === 0 ? errorMessage(error) : `${errorMessage(error)}\n\n${diagnostics}`)
  })
}

async function activateCandidate(candidate: { process: WebHostProcess; url: string }): Promise<void> {
  host = candidate.process
  readyUrl = candidate.url
  try {
    await loadHostUrl(candidate.url)
  } catch (error: unknown) {
    if (host === candidate.process) host = undefined
    readyUrl = undefined
    await candidate.process.stop().catch(() => undefined)
    throw error
  }
  observeHost(candidate.process)
}

async function askForRecovery(failure: string): Promise<number> {
  const options: MessageBoxOptions = {
    type: 'error',
    title: 'DeepSeek Harness Host 已停止',
    message: '本地 Host 无法自动恢复',
    detail: `${failure.slice(-6_000)}\n\n重新启动不会删除本地身份或消息数据。`,
    buttons: ['重新启动 Host', '复制诊断信息', '退出应用'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const owner = window
  const result = owner === undefined || owner.isDestroyed()
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(owner, options)
  return result.response
}

async function recoverHost(initialFailure: string): Promise<void> {
  let failure = initialFailure
  while (!shutdownStarted && !allowQuit) {
    const delayMs = restartPolicy.nextDelay()
    if (delayMs === null) break
    await showRecoveryPage('restarting').catch((error: unknown) => {
      console.error('dsh Electron: could not show Host recovery state:', error)
    })
    await wait(delayMs)
    if (shutdownStarted || allowQuit) return
    try {
      await activateCandidate(await launchCandidate())
      return
    } catch (error: unknown) {
      failure = errorMessage(error)
      console.error('dsh Electron: automatic Host restart failed:', error)
    }
  }

  await showRecoveryPage('stopped').catch((error: unknown) => {
    console.error('dsh Electron: could not show stopped Host state:', error)
  })
  while (!shutdownStarted && !allowQuit) {
    const response = await askForRecovery(failure)
    if (response === 1) {
      clipboard.writeText(failure)
      continue
    }
    if (response === 2) {
      allowQuit = true
      app.quit()
      return
    }
    await showRecoveryPage('restarting').catch(() => undefined)
    try {
      await activateCandidate(await launchCandidate())
      return
    } catch (error: unknown) {
      failure = errorMessage(error)
      console.error('dsh Electron: manual Host restart failed:', error)
      await showRecoveryPage('stopped').catch(() => undefined)
    }
  }
}

function scheduleRecovery(failure: string): void {
  if (shutdownStarted || allowQuit) return
  if (recoveryPromise !== undefined) {
    queuedRecoveryFailure = failure
    return
  }
  recoveryPromise = recoverHost(failure).finally(() => {
    recoveryPromise = undefined
    const queued = queuedRecoveryFailure
    queuedRecoveryFailure = undefined
    if (queued !== undefined) scheduleRecovery(queued)
  })
}

async function start(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId('com.agentconnect.deepseek-harness')
  const runtimeRoot = app.isPackaged
    ? await ensurePackagedRuntime({
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath('userData'),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      })
    : process.resourcesPath
  const launch = resolveHostLaunch(app.isPackaged, runtimeRoot, process.execPath, process.env)
  const cwd = resolveWorkspaceRoot(process.env.DSH_ELECTRON_WORKSPACE, app.getPath('home'))
  launchOptions = {
    ...launch,
    cwd,
    onStdoutLine: (line) => { console.log(`[dsh] ${line}`) },
    onStderrLine: (line) => { console.error(`[dsh] ${line}`) },
  }
  await activateCandidate(await launchCandidate())
}

async function failStartup(error: unknown): Promise<void> {
  shutdownStarted = true
  try {
    await host?.stop()
  } catch (stopError: unknown) {
    console.error('dsh Electron: Host cleanup failed:', stopError)
  }
  dialog.showErrorBox('DeepSeek Harness could not start', errorMessage(error))
  allowQuit = true
  app.exit(1)
}

app.on('before-quit', (event) => {
  if (allowQuit) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  const stopping = host
  host = undefined
  const stopped = stopping === undefined ? Promise.resolve() : stopping.stop()
  void stopped.then(() => {
    allowQuit = true
    app.quit()
  }, (error: unknown) => {
    console.error('dsh Electron: Host cleanup failed:', error)
    allowQuit = true
    app.exit(1)
  })
})

app.on('window-all-closed', () => { app.quit() })
app.on('activate', () => {
  if (window !== undefined) return
  void createWindow().then(async () => {
    if (readyUrl !== undefined) await loadHostUrl(readyUrl)
    else await showRecoveryPage('stopped')
  }).catch(failStartup)
})

void app.whenReady().then(start).catch(failStartup)
