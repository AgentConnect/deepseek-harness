/** Verify the target architecture, runtime provenance, and macOS installer containers. */

import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { x as extractTar } from 'tar'
import { resolveDevelopmentPackageOverrideArchives } from './dev-package-overrides.mjs'
import {
  digestDirectory,
  digestFile,
  readRuntimeProvenance,
} from './runtime-provenance.mjs'
import { parseRuntimeTarget } from './runtime-target.mjs'
import { findMachOBinaries } from './sign-macos-runtime.mjs'

const exec = promisify(execFile)
const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))

function parseArguments(args) {
  const packageOnly = args.includes('--package-only')
  const target = parseRuntimeTarget(args.filter(argument => argument !== '--package-only'))
  if (target.platform !== 'darwin') throw new Error('macOS artifact verification requires a darwin target')
  return { ...target, packageOnly }
}

/**
 * Require one Mach-O file to contain the requested target architecture.
 * @param {string} path - Mach-O file path.
 * @param {'arm64' | 'x64'} arch - Required architecture.
 * @param {(file: string, args: string[]) => Promise<{stdout: string}>} [run] - Command runner.
 * @returns {Promise<string[]>} Architectures reported by lipo.
 */
export async function verifyMachOArchitecture(path, arch, run = exec) {
  let result
  try {
    result = await run('lipo', ['-archs', path])
  } catch (error) {
    throw new Error(`cannot inspect Mach-O architecture: ${path}`, { cause: error })
  }
  const architectures = result.stdout.trim().split(/\s+/u).filter(Boolean)
  const expectedArchitecture = arch === 'x64' ? 'x86_64' : arch
  if (!architectures.includes(expectedArchitecture)) {
    throw new Error(`Mach-O file does not support ${arch}: ${path} (${architectures.join(', ')})`)
  }
  return architectures
}

async function verifyLocalOverrides(runtimeRoot, provenance, localOverrides) {
  if (!localOverrides && provenance.localOverrides.length > 0) {
    throw new Error('release artifact unexpectedly contains local package overrides')
  }
  const configured = localOverrides
    ? await resolveDevelopmentPackageOverrideArchives({ repositoryRoot })
    : []
  if (localOverrides && configured.length === 0) {
    throw new Error('local artifact verification requires at least one configured package override')
  }
  if (configured.length !== provenance.localOverrides.length) {
    throw new Error(`configured override count ${configured.length} does not match packaged override count ${provenance.localOverrides.length}`)
  }

  const configuredByName = new Map(configured.map(override => [override.name, override]))
  for (const override of provenance.localOverrides) {
    const configuration = configuredByName.get(override.name)
    if (configuration === undefined) throw new Error(`packaged local override is not configured: ${override.name}`)
    const archiveSha256 = await digestFile(configuration.archivePath)
    if (archiveSha256 !== override.archiveSha256) {
      throw new Error(`packed archive digest changed after staging: ${override.name}`)
    }
    const packageRoot = join(runtimeRoot, ...override.packagePath.split('/'))
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    if (manifest.version !== override.version) {
      throw new Error(`packaged local override version does not match provenance: ${override.name}`)
    }
    const installedPackageSha256 = await digestDirectory(packageRoot)
    if (installedPackageSha256 !== override.installedPackageSha256) {
      throw new Error(`packaged local override content does not match provenance: ${override.name}`)
    }
  }
}

/**
 * Verify one packaged macOS application and its optional DMG and ZIP containers.
 * @param {object} options - Expected build and verification mode.
 * @param {'arm64' | 'x64'} options.arch - Target architecture.
 * @param {boolean} options.localOverrides - Whether configured local packages must be present.
 * @param {boolean} options.packageOnly - Skip DMG and ZIP verification for `electron-forge package`.
 * @returns {Promise<{app: string, dmg?: string, zip?: string, nativeFileCount: number, localOverrides: Array<{name: string, version: string}>}>} Verified artifact summary.
 */
export async function verifyMacosArtifacts({ arch, localOverrides, packageOnly }) {
  const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  const app = join(appRoot, 'out', `${manifest.productName}-darwin-${arch}`, `${manifest.productName}.app`)
  const executable = join(app, 'Contents', 'MacOS', 'deepseek-harness')
  const archive = join(app, 'Contents', 'Resources', '.forge-runtime.tar.gz')
  await access(executable, constants.R_OK)
  await access(archive, constants.R_OK)
  await verifyMachOArchitecture(executable, arch)

  const extractionRoot = await mkdtemp(join(tmpdir(), 'dsh-verify-runtime-'))
  try {
    await extractTar({ cwd: extractionRoot, file: archive, preservePaths: false, strict: true })
    const provenance = await readRuntimeProvenance(extractionRoot)
    if (provenance.target.platform !== 'darwin' || provenance.target.arch !== arch) {
      throw new Error(`runtime target ${provenance.target.platform}-${provenance.target.arch} does not match darwin-${arch}`)
    }
    await verifyLocalOverrides(extractionRoot, provenance, localOverrides)

    const nativeFiles = await findMachOBinaries(extractionRoot)
    for (const nativeFile of nativeFiles) await verifyMachOArchitecture(nativeFile, arch)
    const spawnHelper = join(extractionRoot, 'node_modules', 'node-pty', 'prebuilds', `darwin-${arch}`, 'spawn-helper')
    await access(spawnHelper, constants.X_OK)

    const summary = {
      app,
      localOverrides: provenance.localOverrides.map(override => ({ name: override.name, version: override.version })),
      nativeFileCount: nativeFiles.length,
    }
    if (packageOnly) return summary

    const dmg = join(appRoot, 'out', 'make', `${manifest.productName}-${manifest.version}-${arch}.dmg`)
    const zip = join(
      appRoot,
      'out',
      'make',
      'zip',
      'darwin',
      arch,
      `${manifest.productName}-darwin-${arch}-${manifest.version}.zip`,
    )
    await exec('hdiutil', ['verify', dmg])
    await exec('unzip', ['-tq', zip])
    return { ...summary, dmg, zip }
  } finally {
    await rm(extractionRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = parseArguments(process.argv.slice(2))
  const result = await verifyMacosArtifacts({
    arch: target.arch,
    localOverrides: target.localOverrides,
    packageOnly: target.packageOnly,
  })
  process.stdout.write([
    `verify-macos-artifacts: ${target.arch} application verified`,
    `runtime Mach-O files: ${result.nativeFileCount}`,
    `local overrides: ${result.localOverrides.map(override => `${override.name}@${override.version}`).join(', ') || 'none'}`,
    ...(result.dmg === undefined ? [] : [`DMG: ${result.dmg}`, `ZIP: ${result.zip}`]),
    '',
  ].join('\n'))
}
