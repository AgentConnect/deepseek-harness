import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  digestDirectory,
  readRuntimeProvenance,
  writeRuntimeProvenance,
} from '../scripts/runtime-provenance.mjs'
import { parseRuntimeTarget } from '../scripts/runtime-target.mjs'
import {
  applyStagedPackageOverrides,
  materializeStagedPackageOverrides,
} from '../scripts/staged-package-overrides.mjs'
import { verifyMachOArchitecture } from '../scripts/verify-macos-artifacts.mjs'

const roots: string[] = []

async function createStagedOverrideFixture() {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'dsh-staged-overrides-'))
  roots.push(repositoryRoot)
  const runtimeRoot = join(repositoryRoot, 'runtime')
  const nodeModules = join(runtimeRoot, 'node_modules')
  const packageName = '@scope/plugin'
  const publicPackage = join(nodeModules, ...packageName.split('/'))
  const archiveSource = join(repositoryRoot, 'archive-source', 'package')
  const archivePath = join(repositoryRoot, 'local-plugin.tgz')
  await mkdir(join(nodeModules, '@deepseek-ai', 'dsh'), { recursive: true })
  await mkdir(publicPackage, { recursive: true })
  await mkdir(archiveSource, { recursive: true })
  await writeFile(join(nodeModules, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
    dependencies: { [packageName]: '1.0.0' },
    name: '@deepseek-ai/dsh',
  }))
  await writeFile(join(publicPackage, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0' }))
  await writeFile(join(archiveSource, 'package.json'), JSON.stringify({ name: packageName, version: '2.0.0' }))
  await writeFile(join(archiveSource, 'marker.txt'), 'local package')
  await createTar({ cwd: join(repositoryRoot, 'archive-source'), file: archivePath, gzip: true }, ['package'])
  await writeFile(join(repositoryRoot, '.dev-package-overrides.json'), JSON.stringify({ [packageName]: archivePath }))
  return { archivePath, archiveSource, packageName, repositoryRoot, runtimeRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('runtime packaging target', () => {
  it('requires a complete supported target and never derives it from the host process', () => {
    expect(parseRuntimeTarget(['--platform=darwin', '--arch=x64'])).toEqual({
      arch: 'x64',
      localOverrides: false,
      platform: 'darwin',
    })
    expect(parseRuntimeTarget(['--platform=darwin', '--arch=arm64', '--local-overrides'])).toEqual({
      arch: 'arm64',
      localOverrides: true,
      platform: 'darwin',
    })
    expect(() => parseRuntimeTarget(['--platform=darwin'])).toThrow('requires --platform')
    expect(() => parseRuntimeTarget(['--platform=win32', '--arch=arm64'])).toThrow('unsupported runtime target')
  })
})

describe('staged package overrides', () => {
  it('replaces only a package declared by the staged CLI manifest', async () => {
    const fixture = await createStagedOverrideFixture()

    const applied = await applyStagedPackageOverrides(fixture)

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ name: fixture.packageName, version: '2.0.0' })
    expect(await readFile(join(fixture.runtimeRoot, 'node_modules', '@scope', 'plugin', 'marker.txt'), 'utf8'))
      .toBe('local package')
  })

  it('rejects dependencies absent from the locked staged closure', async () => {
    const fixture = await createStagedOverrideFixture()
    await writeFile(join(fixture.archiveSource, 'package.json'), JSON.stringify({
      dependencies: { 'new-unlocked-dependency': '1.0.0' },
      name: fixture.packageName,
      version: '2.0.0',
    }))
    await createTar({ cwd: join(fixture.repositoryRoot, 'archive-source'), file: fixture.archivePath, gzip: true }, ['package'])

    await expect(applyStagedPackageOverrides(fixture))
      .rejects.toThrow('dependencies are absent from the locked runtime: new-unlocked-dependency')
  })

  it('materializes reachable transitive overrides under their local parent packages', async () => {
    const fixture = await createStagedOverrideFixture()
    const sdkName = '@scope/sdk'
    const nativeName = '@scope/native'
    const nodeModules = join(fixture.runtimeRoot, 'node_modules')
    const publicSdk = join(nodeModules, ...sdkName.split('/'))
    const publicNative = join(nodeModules, ...nativeName.split('/'))
    await mkdir(publicSdk, { recursive: true })
    await mkdir(publicNative, { recursive: true })
    await writeFile(join(publicSdk, 'package.json'), JSON.stringify({ name: sdkName, version: '1.0.0' }))
    await writeFile(join(publicSdk, 'marker.txt'), 'public sdk')
    await writeFile(join(publicNative, 'package.json'), JSON.stringify({ name: nativeName, version: '1.0.0' }))
    await writeFile(join(publicNative, 'marker.txt'), 'public native')
    await writeFile(join(fixture.archiveSource, 'package.json'), JSON.stringify({
      dependencies: { [sdkName]: '2.0.0' },
      name: fixture.packageName,
      version: '2.0.0',
    }))
    await createTar({ cwd: join(fixture.repositoryRoot, 'archive-source'), file: fixture.archivePath, gzip: true }, ['package'])

    const sdkSourceRoot = join(fixture.repositoryRoot, 'sdk-source')
    const sdkSource = join(sdkSourceRoot, 'package')
    const sdkArchive = join(fixture.repositoryRoot, 'local-sdk.tgz')
    await mkdir(sdkSource, { recursive: true })
    await writeFile(join(sdkSource, 'package.json'), JSON.stringify({
      name: sdkName,
      optionalDependencies: { [nativeName]: '2.0.0' },
      version: '2.0.0',
    }))
    await writeFile(join(sdkSource, 'marker.txt'), 'local sdk')
    await createTar({ cwd: sdkSourceRoot, file: sdkArchive, gzip: true }, ['package'])

    const nativeSourceRoot = join(fixture.repositoryRoot, 'native-source')
    const nativeSource = join(nativeSourceRoot, 'package')
    const nativeArchive = join(fixture.repositoryRoot, 'local-native.tgz')
    await mkdir(nativeSource, { recursive: true })
    await writeFile(join(nativeSource, 'package.json'), JSON.stringify({ name: nativeName, version: '2.0.0' }))
    await writeFile(join(nativeSource, 'marker.txt'), 'local native')
    await createTar({ cwd: nativeSourceRoot, file: nativeArchive, gzip: true }, ['package'])
    await writeFile(join(fixture.repositoryRoot, '.dev-package-overrides.json'), JSON.stringify({
      [fixture.packageName]: fixture.archivePath,
      [sdkName]: sdkArchive,
      [nativeName]: nativeArchive,
    }))

    const applied = await applyStagedPackageOverrides(fixture)
    await materializeStagedPackageOverrides({ applied, runtimeRoot: fixture.runtimeRoot })

    const localSdk = join(nodeModules, '@scope', 'plugin', 'node_modules', '@scope', 'sdk')
    const localNative = join(localSdk, 'node_modules', '@scope', 'native')
    expect(await readFile(join(localSdk, 'marker.txt'), 'utf8')).toBe('local sdk')
    expect(await readFile(join(localNative, 'marker.txt'), 'utf8')).toBe('local native')
    expect(await readFile(join(publicSdk, 'marker.txt'), 'utf8')).toBe('public sdk')
    expect(applied.map(override => override.direct)).toEqual([false, true, false])
  })
})

describe('runtime provenance and architecture verification', () => {
  it('records a stable installed package digest and target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-provenance-'))
    roots.push(root)
    const packageRoot = join(root, 'node_modules', '@scope', 'plugin')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, 'index.js'), 'export default true\n')
    const installedPackageSha256 = await digestDirectory(packageRoot)

    await writeRuntimeProvenance({
      root,
      platform: 'darwin',
      arch: 'x64',
      localOverrides: [{
        archiveSha256: 'a'.repeat(64),
        installedPackageSha256,
        name: '@scope/plugin',
        packagePath: 'node_modules/@scope/plugin',
        version: '2.0.0',
      }],
    })

    await expect(readRuntimeProvenance(root)).resolves.toMatchObject({
      schemaVersion: 2,
      target: { arch: 'x64', platform: 'darwin' },
      localOverrides: [{
        installedPackageSha256,
        name: '@scope/plugin',
        packagePath: 'node_modules/@scope/plugin',
      }],
    })
  })

  it('rejects a Mach-O file that does not contain the requested architecture', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'arm64\n' })
    await expect(verifyMachOArchitecture('/tmp/application', 'x64', run))
      .rejects.toThrow('does not support x64')
    await expect(verifyMachOArchitecture('/tmp/application', 'arm64', run))
      .resolves.toEqual(['arm64'])
  })

  it('maps the Node x64 target name to the Mach-O x86_64 architecture', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'x86_64\n' })
    await expect(verifyMachOArchitecture('/tmp/application', 'x64', run))
      .resolves.toEqual(['x86_64'])
  })
})
