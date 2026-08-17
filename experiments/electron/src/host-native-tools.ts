import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

/** Runtime dependencies used to rebuild native tools loaded by the host Node process. */
export interface HostNativeToolsRuntime {
  execPath: string
  platform: NodeJS.Platform
  resolveModule: (specifier: string) => string
  run: (file: string, args: string[], options: { cwd: string }) => Promise<void>
}

const exec = promisify(execFile)
const require = createRequire(import.meta.url)

const defaultRuntime: HostNativeToolsRuntime = {
  execPath: process.execPath,
  platform: process.platform,
  resolveModule: require.resolve,
  run: async (file, args, options) => {
    await exec(file, args, options)
  },
}

/**
 * Rebuild the DMG maker's native dependency for the Node process that runs Forge.
 * Electron Packager rebuilds it for Electron first, so this must run after packaging.
 */
export async function rebuildMacosAliasForHost(
  runtime: HostNativeToolsRuntime = defaultRuntime,
): Promise<boolean> {
  if (runtime.platform !== 'darwin') return false

  const aliasRoot = dirname(runtime.resolveModule('macos-alias/package.json'))
  const nodeGyp = runtime.resolveModule('node-gyp/bin/node-gyp.js')
  await runtime.run(runtime.execPath, [nodeGyp, 'rebuild'], { cwd: aliasRoot })
  return true
}
