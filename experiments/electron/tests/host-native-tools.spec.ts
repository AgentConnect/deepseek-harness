import { describe, expect, it, vi } from 'vitest'
import { createForgeConfig } from '../forge.config.ts'
import {
  rebuildMacosAliasForHost,
  type HostNativeToolsRuntime,
} from '../src/host-native-tools.ts'

function createRuntime(platform: NodeJS.Platform) {
  const run = vi.fn<HostNativeToolsRuntime['run']>().mockResolvedValue()
  const runtime: HostNativeToolsRuntime = {
    execPath: '/usr/local/bin/node',
    platform,
    resolveModule: specifier => `/workspace/node_modules/${specifier}`,
    run,
  }
  return { run, runtime }
}

describe('host native build tools', () => {
  it('restores macos-alias for the host Node ABI after Electron packaging', async () => {
    const { run, runtime } = createRuntime('darwin')

    await expect(rebuildMacosAliasForHost(runtime)).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      ['/workspace/node_modules/node-gyp/bin/node-gyp.js', 'rebuild'],
      { cwd: '/workspace/node_modules/macos-alias' },
    )
  })

  it('does not rebuild macOS-only tools on other hosts', async () => {
    const { run, runtime } = createRuntime('win32')

    await expect(rebuildMacosAliasForHost(runtime)).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the host-native rebuild from the Forge preMake hook', async () => {
    const rebuild = vi.fn().mockResolvedValue(true)
    const config = createForgeConfig({}, rebuild)

    expect(config.hooks?.preMake).toBeTypeOf('function')
    await config.hooks?.preMake?.({} as never)
    expect(rebuild).toHaveBeenCalledOnce()
  })
})
