import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { c as createTar } from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyDevelopmentPackageOverrides,
  resolveDevelopmentPackageOverrideArchives,
} from '../scripts/dev-package-overrides.mjs'
import { startDevelopmentApplication } from '../scripts/start-dev.mjs'

const roots: string[] = []

async function createFixture(packageName = '@scope/pkg') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-package-overrides-'))
  roots.push(root)
  const packageSource = join(root, 'archive-source', 'package')
  const cliNodeModules = join(root, 'apps', 'cli', 'node_modules')
  const dependencyRoot = join(root, '.pnpm', 'installed-package', 'node_modules')
  const publicPackage = join(dependencyRoot, ...packageName.split('/'))
  const archivePath = join(root, 'local-package.tgz')
  const configPath = join(root, '.dev-package-overrides.json')
  await mkdir(packageSource, { recursive: true })
  await mkdir(cliNodeModules, { recursive: true })
  await mkdir(publicPackage, { recursive: true })
  await writeFile(join(root, 'apps', 'cli', 'package.json'), JSON.stringify({
    dependencies: { [packageName]: '1.0.0' },
    name: 'fixture-cli',
  }))
  await writeFile(join(packageSource, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0' }))
  await writeFile(join(packageSource, 'marker.txt'), 'local override')
  await writeFile(join(publicPackage, 'package.json'), JSON.stringify({ name: packageName, version: '0.9.0' }))
  await writeFile(join(publicPackage, 'marker.txt'), 'public package')
  const target = join(cliNodeModules, ...packageName.split('/'))
  await mkdir(join(target, '..'), { recursive: true })
  await symlink(publicPackage, target, 'dir')
  await createTar({ cwd: join(root, 'archive-source'), file: archivePath, gzip: true }, ['package'])
  await writeFile(configPath, JSON.stringify({ [packageName]: archivePath }))
  const overrideOptions = {
    repositoryRoot: root,
    resolveInstalledPackage: () => publicPackage,
  }
  return { archivePath, cliNodeModules, configPath, dependencyRoot, overrideOptions, packageName, publicPackage, root }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('development package overrides', () => {
  it('mounts a validated packed package at the CLI resolver path', async () => {
    const fixture = await createFixture()

    const applied = await applyDevelopmentPackageOverrides(fixture.overrideOptions)

    const target = join(fixture.cliNodeModules, '@scope', 'pkg')
    expect(await readFile(join(target, 'marker.txt'), 'utf8')).toBe('local override')
    expect(await realpath(target)).toBe(await realpath(applied[0]?.packageRoot ?? ''))
    expect(applied[0]?.archivePath).toBe(fixture.archivePath)
    expect(applied[0]?.archiveSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(applied[0]?.version).toBe('1.0.0')
  })

  it('resolves configured archives without modifying a package resolver', async () => {
    const fixture = await createFixture()

    await expect(resolveDevelopmentPackageOverrideArchives({ repositoryRoot: fixture.root }))
      .resolves.toEqual([{ archivePath: fixture.archivePath, name: fixture.packageName }])
    expect(await readFile(join(fixture.publicPackage, 'marker.txt'), 'utf8')).toBe('public package')
  })

  it('resolves the packed package through the installed dependency closure', async () => {
    const fixture = await createFixture()
    const publicDependency = join(fixture.dependencyRoot, 'public-dependency')
    await mkdir(publicDependency)
    await writeFile(join(publicDependency, 'package.json'), JSON.stringify({
      exports: './index.js',
      name: 'public-dependency',
      type: 'module',
    }))
    await writeFile(join(publicDependency, 'index.js'), 'export default "public dependency"\n')
    const workspacePeer = join(fixture.cliNodeModules, 'workspace-peer')
    await mkdir(workspacePeer)
    await writeFile(join(workspacePeer, 'package.json'), JSON.stringify({
      exports: './index.js',
      name: 'workspace-peer',
      type: 'module',
    }))
    await writeFile(join(workspacePeer, 'index.js'), 'export default "workspace peer"\n')
    const packageSource = join(fixture.root, 'archive-source', 'package')
    await writeFile(join(packageSource, 'package.json'), JSON.stringify({
      dependencies: {
        'installed-dependency': '1.0.0',
        'public-dependency': '1.0.0',
      },
      name: fixture.packageName,
      peerDependencies: { 'workspace-peer': '1.0.0' },
      type: 'module',
      version: '1.0.0',
    }))
    await writeFile(join(packageSource, 'index.js'), [
      'import installed from "installed-dependency"',
      'import peer from "workspace-peer"',
      'import publicDependency from "public-dependency"',
      'export default `${publicDependency} + ${installed} + ${peer}`',
      '',
    ].join('\n'))
    await createTar({ cwd: join(fixture.root, 'archive-source'), file: fixture.archivePath, gzip: true }, ['package'])

    await applyDevelopmentPackageOverrides({
      ...fixture.overrideOptions,
      async installDependencies({ storageRoot }) {
        const installed = join(storageRoot, 'fixture-installed', 'node_modules', 'installed-dependency')
        await mkdir(installed, { recursive: true })
        await writeFile(join(installed, 'package.json'), JSON.stringify({
          exports: './index.js',
          name: 'installed-dependency',
          type: 'module',
        }))
        await writeFile(join(installed, 'index.js'), 'export default "installed dependency"\n')
        return join(storageRoot, 'fixture-installed', 'node_modules')
      },
    })

    const entry = join(fixture.cliNodeModules, '@scope', 'pkg', 'index.js')
    const loaded = await import(/* @vite-ignore */ `${pathToFileURL(entry).href}?test=${Date.now()}`)
    expect(loaded.default).toBe('public dependency + installed dependency + workspace peer')
  })

  it('does nothing when the machine-local configuration is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-dev-package-overrides-'))
    roots.push(root)

    await expect(applyDevelopmentPackageOverrides({ repositoryRoot: root })).resolves.toEqual([])
  })

  it('rejects invalid JSON before changing the resolver tree', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.configPath, '{')

    await expect(applyDevelopmentPackageOverrides(fixture.overrideOptions))
      .rejects.toThrow('invalid JSON')
  })

  it.each([
    ['an invalid package name', { '../pkg': 'local-package.tgz' }, 'invalid npm package name'],
    ['an undeclared package', { 'other-package': 'local-package.tgz' }, 'is not a declared CLI dependency'],
    ['a missing archive', { '@scope/pkg': 'missing.tgz' }, 'is not a regular file'],
    ['a non-archive path', { '@scope/pkg': 'local-package.zip' }, 'must reference a .tgz or .tar.gz archive'],
  ])('rejects %s', async (_label, config, expected) => {
    const fixture = await createFixture()
    await writeFile(fixture.configPath, JSON.stringify(config))

    await expect(applyDevelopmentPackageOverrides(fixture.overrideOptions))
      .rejects.toThrow(expected)
  })

  it('rejects an archive whose package name does not match the configured dependency', async () => {
    const fixture = await createFixture('@scope/archive-name')
    await writeFile(join(fixture.root, 'apps', 'cli', 'package.json'), JSON.stringify({
      dependencies: { '@scope/configured-name': '1.0.0' },
      name: 'fixture-cli',
    }))
    await symlink(
      fixture.publicPackage,
      join(fixture.cliNodeModules, '@scope', 'configured-name'),
      'dir',
    )
    await writeFile(fixture.configPath, JSON.stringify({
      '@scope/configured-name': fixture.archivePath,
    }))

    await expect(applyDevelopmentPackageOverrides(fixture.overrideOptions))
      .rejects.toThrow('does not match configured name')
  })

  it('replaces an existing symlink without following or deleting its target', async () => {
    const fixture = await createFixture()
    const target = join(fixture.cliNodeModules, '@scope', 'pkg')

    await applyDevelopmentPackageOverrides(fixture.overrideOptions)

    expect(await readFile(join(fixture.publicPackage, 'marker.txt'), 'utf8')).toBe('public package')
    expect(await readFile(join(target, 'marker.txt'), 'utf8')).toBe('local override')
    expect(await realpath(target)).not.toBe(await realpath(fixture.publicPackage))
  })
})

describe('development launcher', () => {
  it('applies package overrides after the build and before Electron starts', async () => {
    const events: string[] = []
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      events.push(args.join(' '))
      return { error: undefined, status: 0 }
    })
    const applyOverrides = vi.fn(async () => {
      events.push('apply overrides')
      return []
    })

    await expect(startDevelopmentApplication({
      applyOverrides,
      environment: {},
      platform: 'darwin',
      repositoryRoot: '/workspace',
      spawn: spawn as never,
    })).resolves.toBe(0)

    expect(events).toEqual([
      '--dir /workspace run build',
      'apply overrides',
      '--filter deepseek-harness-electron start:built',
    ])
  })

  it('does not apply overrides or launch Electron after a failed build', async () => {
    const applyOverrides = vi.fn()
    const spawn = vi.fn(() => ({ error: undefined, status: 2 }))

    await expect(startDevelopmentApplication({
      applyOverrides,
      repositoryRoot: '/workspace',
      spawn: spawn as never,
    })).resolves.toBe(2)

    expect(applyOverrides).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledOnce()
  })
})
