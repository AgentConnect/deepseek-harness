import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneRuntime } from '../scripts/prune-runtime.mjs'
import { pruneElectronLocales } from '../src/package-prune.ts'
import { resolveHostLaunch, resolveWorkspaceRoot } from '../src/runtime.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Electron runtime resolution', () => {
  it('uses the development and packaged launch contracts', () => {
    expect(resolveHostLaunch(false, '/unused', '/Applications/Harness', { DSH_ELECTRON_NODE: '/opt/node/bin/node' }).command)
      .toBe('/opt/node/bin/node')
    expect(resolveHostLaunch(true, '/App/Contents/Resources', '/App/Contents/MacOS/deepseek-harness', { KEEP: 'yes' }))
      .toEqual({
        command: '/App/Contents/MacOS/deepseek-harness',
        args: ['--expose-internals', '/App/Contents/Resources/.forge-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--port', '0'],
        env: { KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1' },
      })
  })

  it('defaults to home and rejects an invalid workspace override', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-electron-home-'))
    temporaryDirectories.push(home)
    expect(resolveWorkspaceRoot(undefined, home)).toBe(home)
    expect(() => resolveWorkspaceRoot('relative/workspace', home)).toThrow('workspace must be an absolute path')
    expect(() => resolveWorkspaceRoot(join(home, 'missing'), home)).toThrow('workspace is not an accessible directory')
  })
})

describe('Electron package pruning', () => {
  it('keeps only the target node-pty prebuild and removes development artifacts', async () => {
    const runtime = await mkdtemp(join(tmpdir(), 'dsh-electron-runtime-'))
    temporaryDirectories.push(runtime)
    const nodeModules = join(runtime, 'node_modules')
    const nodePty = join(nodeModules, 'node-pty')
    for (const path of [join(nodePty, 'prebuilds', 'darwin-arm64'), join(nodePty, 'prebuilds', 'win32-x64'), join(nodePty, 'src'), join(nodeModules, 'dependency', 'tests')]) {
      await mkdir(path, { recursive: true })
    }
    await Promise.all([
      writeFile(join(nodePty, 'prebuilds', 'darwin-arm64', 'pty.node'), 'target'),
      writeFile(join(nodePty, 'prebuilds', 'win32-x64', 'pty.pdb'), 'debug'),
      writeFile(join(nodePty, 'src', 'unix.ts'), 'source'),
      writeFile(join(nodeModules, 'dependency', 'index.js'), 'runtime'),
      writeFile(join(nodeModules, 'dependency', 'index.js.map'), 'map'),
      writeFile(join(nodeModules, 'dependency', 'tests', 'index.js'), 'test'),
    ])
    await pruneRuntime(runtime, 'darwin', 'arm64')
    await expect(access(join(nodePty, 'prebuilds', 'darwin-arm64', 'pty.node'))).resolves.toBeUndefined()
    await expect(access(join(nodeModules, 'dependency', 'index.js'))).resolves.toBeUndefined()
    await expect(access(join(nodePty, 'prebuilds', 'win32-x64'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(nodeModules, 'dependency', 'tests'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains only supported macOS Electron locale bundles', async () => {
    const buildPath = await mkdtemp(join(tmpdir(), 'dsh-electron-package-'))
    temporaryDirectories.push(buildPath)
    const resources = join(buildPath, 'Electron.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources')
    for (const locale of ['en.lproj', 'zh_CN.lproj', 'fr.lproj']) await mkdir(join(resources, locale), { recursive: true })
    await pruneElectronLocales(buildPath, 'darwin')
    await expect(access(join(resources, 'en.lproj'))).resolves.toBeUndefined()
    await expect(access(join(resources, 'zh_CN.lproj'))).resolves.toBeUndefined()
    await expect(access(join(resources, 'fr.lproj'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
