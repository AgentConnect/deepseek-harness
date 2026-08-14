/** Electron desktop shell over the existing loopback DSH Web application. */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { WebHostProcess } from './host-process.ts'
import { resolveHostLaunch, resolveWorkspaceRoot } from './runtime.ts'

let host: WebHostProcess | undefined
let readyUrl: string | undefined
let window: BrowserWindow | undefined
let shutdownStarted = false
let allowQuit = false

async function createWindow(url: string): Promise<void> {
  const allowedOrigin = new URL(url).origin
  window = new BrowserWindow({
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
  window.once('ready-to-show', () => { window?.show() })
  window.on('closed', () => { window = undefined })
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== allowedOrigin) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
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
  await window.loadURL(url)
}

async function start(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId('com.agentconnect.deepseek-harness')
  const launch = resolveHostLaunch(app.isPackaged, process.resourcesPath, process.execPath, process.env)
  const cwd = resolveWorkspaceRoot(process.env.DSH_ELECTRON_WORKSPACE, app.getPath('home'))
  host = WebHostProcess.launch({
    ...launch,
    cwd,
    onStdoutLine: (line) => { console.log(`[dsh] ${line}`) },
    onStderrLine: (line) => { console.error(`[dsh] ${line}`) },
  })
  readyUrl = await host.ready
  void host.exited.then(({ code, signal }) => {
    if (shutdownStarted || allowQuit) return
    allowQuit = true
    dialog.showErrorBox('DeepSeek Harness Host stopped', `The local Host exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`)
    app.quit()
  }, (error: unknown) => {
    if (shutdownStarted || allowQuit) return
    allowQuit = true
    dialog.showErrorBox('DeepSeek Harness Host failed', String(error))
    app.quit()
  })
  await createWindow(readyUrl)
}

async function failStartup(error: unknown): Promise<void> {
  shutdownStarted = true
  try {
    await host?.stop()
  } catch (stopError: unknown) {
    console.error('dsh Electron: Host cleanup failed:', stopError)
  }
  dialog.showErrorBox('DeepSeek Harness could not start', error instanceof Error ? error.message : String(error))
  allowQuit = true
  app.exit(1)
}

app.on('before-quit', (event) => {
  if (allowQuit || host === undefined) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  void host.stop().then(() => {
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
  if (window === undefined && readyUrl !== undefined) void createWindow(readyUrl).catch(failStartup)
})

void app.whenReady().then(start).catch(failStartup)
