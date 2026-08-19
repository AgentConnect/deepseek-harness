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
import { applyStagedPackageOverrides } from '../scripts/staged-package-overrides.mjs'
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
        version: '2.0.0',
      }],
    })

    await expect(readRuntimeProvenance(root)).resolves.toMatchObject({
      schemaVersion: 1,
      target: { arch: 'x64', platform: 'darwin' },
      localOverrides: [{ installedPackageSha256, name: '@scope/plugin' }],
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
