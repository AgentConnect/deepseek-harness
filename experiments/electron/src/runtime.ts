/** Resolve development and packaged DSH Host launch inputs. */

import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Complete command needed by {@link WebHostProcess}. */
export interface ElectronHostLaunch {
  /** Node-compatible executable. */
  command: string
  /** DSH CLI arguments. */
  args: string[]
  /** Environment including Electron's Node mode when packaged. */
  env: NodeJS.ProcessEnv
}

/**
 * Resolve the Host launcher without inspecting the filesystem.
 * @param packaged - whether Electron is running from an application bundle.
 * @param runtimeRoot - extracted packaged runtime root; unused in development.
 * @param electronExecutable - current Electron application executable.
 * @param env - inherited launch environment.
 * @returns executable, arguments, and environment for `dsh web --port 0`.
 */
export function resolveHostLaunch(
  packaged: boolean,
  runtimeRoot: string,
  electronExecutable: string,
  env: NodeJS.ProcessEnv,
): ElectronHostLaunch {
  const bin = packaged
    ? join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    : fileURLToPath(new URL('../../../apps/cli/lib/bin.js', import.meta.url))
  return {
    command: packaged ? electronExecutable : (env.DSH_ELECTRON_NODE ?? 'node'),
    args: [...(packaged ? ['--expose-internals'] : []), bin, 'web', '--port', '0'],
    env: packaged ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : { ...env },
  }
}

/**
 * Resolve and validate the workspace inherited by DSH sessions.
 * @param configured - optional `DSH_ELECTRON_WORKSPACE` value.
 * @param home - Electron's user-home path.
 * @returns an existing absolute directory.
 */
export function resolveWorkspaceRoot(configured: string | undefined, home: string): string {
  const candidate = configured ?? home
  if (!isAbsolute(candidate)) {
    throw new Error(`dsh Electron: workspace must be an absolute path, got ${JSON.stringify(candidate)}`)
  }
  let directory = false
  try {
    directory = statSync(candidate).isDirectory()
  } catch {
    // The diagnostic below owns missing, unreadable, and non-directory paths.
  }
  if (!directory) {
    throw new Error(`dsh Electron: workspace is not an accessible directory: ${JSON.stringify(candidate)}`)
  }
  return candidate
}
