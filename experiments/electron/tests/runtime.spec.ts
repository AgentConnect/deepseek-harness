import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create as createTar } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneRuntime } from '../scripts/prune-runtime.mjs'
import { pruneElectronLocales } from '../src/package-prune.ts'
import { ensurePackagedRuntime } from '../src/runtime-install.ts'
import { configureElectronStateRoot, resolveHostLaunch, resolveWorkspaceRoot } from '../src/runtime.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Electron runtime resolution', () => {
  it('isolates Electron-owned state only for an absolute development override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-electron-state-'))
    temporaryDirectories.push(root)
    const stateRoot = join(root, 'nested', 'electron')
    const assignments: Array<[string, string]> = []
    const registry = {
      setPath: (name: 'userData' | 'sessionData', path: string) => { assignments.push([name, path]) },
    }

    expect(configureElectronStateRoot(undefined, registry)).toBeUndefined()
    expect(configureElectronStateRoot('', registry)).toBeUndefined()
    expect(assignments).toEqual([])
    expect(() => configureElectronStateRoot('relative/state', registry)).toThrow('user-data directory must be an absolute path')

    expect(configureElectronStateRoot(stateRoot, registry)).toBe(stateRoot)
    await expect(access(stateRoot)).resolves.toBeUndefined()
    expect(assignments).toEqual([
      ['userData', stateRoot],
      ['sessionData', stateRoot],
    ])
  })

  it('uses the development and packaged launch contracts', () => {
    expect(resolveHostLaunch(false, '/unused', '/Applications/Harness', { DSH_ELECTRON_NODE: '/opt/node/bin/node' }).command)
      .toBe('/opt/node/bin/node')
    expect(resolveHostLaunch(true, '/Users/test/Library/Application Support/DeepSeek Harness/runtime/0.1.0-darwin-arm64', '/App/Contents/MacOS/deepseek-harness', { KEEP: 'yes' }))
      .toEqual({
        command: '/App/Contents/MacOS/deepseek-harness',
        args: ['--expose-internals', '/Users/test/Library/Application Support/DeepSeek Harness/runtime/0.1.0-darwin-arm64/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--port', '0'],
        env: { KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1' },
      })
  })

  it('atomically extracts and reuses the packaged runtime archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-electron-runtime-install-'))
    temporaryDirectories.push(root)
    const resourcesPath = join(root, 'resources')
    const archiveSource = join(root, 'archive-source')
    const userDataPath = join(root, 'user-data')
    const cli = join(archiveSource, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(resourcesPath, { recursive: true })
    await mkdir(join(archiveSource, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await writeFile(cli, 'packaged-cli', 'utf8')
    await createTar({
      cwd: archiveSource,
      file: join(resourcesPath, '.forge-runtime.tar.gz'),
      gzip: true,
      portable: false,
    }, ['.'])

    const options = { resourcesPath, userDataPath, version: '0.1.0', platform: 'darwin' as const, arch: 'arm64' }
    const installed = await ensurePackagedRuntime(options)
    const installedCli = join(installed, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    expect(await readFile(installedCli, 'utf8')).toBe('packaged-cli')

    await writeFile(installedCli, 'reuse-proof', 'utf8')
    expect(await ensurePackagedRuntime(options)).toBe(installed)
    expect(await readFile(installedCli, 'utf8')).toBe('reuse-proof')
  })

  it('rejects an archive that does not contain the DSH CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-electron-runtime-invalid-'))
    temporaryDirectories.push(root)
    const resourcesPath = join(root, 'resources')
    const archiveSource = join(root, 'archive-source')
    await mkdir(resourcesPath, { recursive: true })
    await mkdir(archiveSource, { recursive: true })
    await writeFile(join(archiveSource, 'not-the-cli.txt'), 'invalid', 'utf8')
    await createTar({
      cwd: archiveSource,
      file: join(resourcesPath, '.forge-runtime.tar.gz'),
      gzip: true,
      portable: false,
    }, ['.'])

    await expect(ensurePackagedRuntime({
      resourcesPath,
      userDataPath: join(root, 'user-data'),
      version: '0.1.0',
      platform: 'win32',
      arch: 'x64',
    })).rejects.toMatchObject({ code: 'ENOENT' })
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
