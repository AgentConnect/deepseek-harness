import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { t as inspectTar, x as extractTar } from 'tar'

export const DEVELOPMENT_PACKAGE_OVERRIDE_CONFIG = '.dev-package-overrides.json'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const ARCHIVE_SUFFIXES = ['.tgz', '.tar.gz']

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

async function pathMetadata(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function validatePackageName(name, configPath) {
  if (name.length > 214 || !PACKAGE_NAME.test(name)) {
    throw new Error(`${configPath}: invalid npm package name ${JSON.stringify(name)}`)
  }
}

async function readConfig(configPath) {
  let content
  try {
    content = await readFile(configPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`${configPath}: cannot read development package overrides: ${message(error)}`, { cause: error })
  }

  let value
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error(`${configPath}: invalid JSON: ${message(error)}`, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${configPath}: expected a JSON object that maps npm package names to packed archive paths`)
  }
  return value
}

async function readCliDependencies(manifestPath) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`${manifestPath}: cannot read CLI package metadata: ${message(error)}`, { cause: error })
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${manifestPath}: expected a package manifest object`)
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`${manifestPath}: CLI package name must be a non-empty string`)
  }
  return {
    dependencies: new Set(Object.keys(manifest.dependencies ?? {})),
    packageName: manifest.name,
  }
}

async function inspectPackedArchive(archivePath) {
  let entryCount = 0
  try {
    await inspectTar({
      file: archivePath,
      onReadEntry(entry) {
        entryCount++
        if (entry.path !== 'package' && !entry.path.startsWith('package/')) {
          throw new Error(`entry ${JSON.stringify(entry.path)} is outside the npm package directory`)
        }
        entry.resume()
      },
      strict: true,
    })
  } catch (error) {
    throw new Error(`${archivePath}: invalid packed package archive: ${message(error)}`, { cause: error })
  }
  if (entryCount === 0) throw new Error(`${archivePath}: packed package archive is empty`)
}

function resolveInstalledPackageWithPnpm({ cliPackageName, packageName, repositoryRoot }) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(
    command,
    ['--filter', cliPackageName, 'list', packageName, '--json', '--depth', '0'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`pnpm could not resolve installed CLI dependency ${JSON.stringify(packageName)}: ${result.stderr.trim()}`)
  }
  let projects
  try {
    projects = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`pnpm returned invalid package metadata for ${JSON.stringify(packageName)}: ${message(error)}`, { cause: error })
  }
  const project = Array.isArray(projects)
    ? projects.find(candidate => candidate?.name === cliPackageName)
    : undefined
  const installedPath = project?.dependencies?.[packageName]?.path
  if (typeof installedPath !== 'string' || installedPath === '') {
    throw new Error(`pnpm did not report an installed path for CLI dependency ${JSON.stringify(packageName)}; run pnpm install --frozen-lockfile`)
  }
  return installedPath
}

async function installedDependencyRoot({ cliNodeModules, installedPackagePath, name }) {
  const metadata = await pathMetadata(installedPackagePath)
  if (metadata === undefined || !metadata.isDirectory()) {
    throw new Error(`${installedPackagePath}: pnpm reported package ${JSON.stringify(name)} at a missing directory; run pnpm install --frozen-lockfile`)
  }
  const installedRoot = await realpath(installedPackagePath)
  const packageSegments = name.split('/')
  const resolver = resolve(installedRoot, ...packageSegments.map(() => '..'))
  return basename(resolver) === 'node_modules' ? resolver : cliNodeModules
}

async function extractPackage({ archivePath, expectedName, storageRoot }) {
  const archive = await readFile(archivePath)
  const archiveSha256 = createHash('sha256').update(archive).digest('hex')
  const storageName = `${Buffer.from(expectedName).toString('base64url')}-${archiveSha256.slice(0, 16)}`
  const packagesRoot = join(storageRoot, 'packages')
  const packageRoot = join(packagesRoot, storageName)
  await mkdir(packagesRoot, { recursive: true })

  const existing = await pathMetadata(packageRoot)
  if (existing !== undefined) {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    if (manifest.name !== expectedName) {
      throw new Error(`${packageRoot}: cached package name ${JSON.stringify(manifest.name)} does not match ${JSON.stringify(expectedName)}`)
    }
    if (typeof manifest.version !== 'string' || manifest.version === '') {
      throw new Error(`${packageRoot}: cached package version must be a non-empty string`)
    }
    return { archiveSha256, manifest, packageRoot, storageName }
  }

  await inspectPackedArchive(archivePath)
  const stagingRoot = await mkdtemp(join(storageRoot, '.extract-'))
  try {
    await extractTar({
      file: archivePath,
      cwd: stagingRoot,
      preservePaths: false,
      strict: true,
      strip: 1,
    })
    let manifest
    try {
      manifest = JSON.parse(await readFile(join(stagingRoot, 'package.json'), 'utf8'))
    } catch (error) {
      throw new Error(`${archivePath}: packed package has no readable package.json: ${message(error)}`, { cause: error })
    }
    if (manifest.name !== expectedName) {
      throw new Error(`${archivePath}: packed package name ${JSON.stringify(manifest.name)} does not match configured name ${JSON.stringify(expectedName)}`)
    }
    if (typeof manifest.version !== 'string' || manifest.version === '') {
      throw new Error(`${archivePath}: packed package version must be a non-empty string`)
    }
    await rename(stagingRoot, packageRoot)
    return { archiveSha256, manifest, packageRoot, storageName }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}

async function dependencyTarget(roots, name) {
  for (const root of roots) {
    const candidate = join(root, ...name.split('/'))
    if (await pathMetadata(candidate) !== undefined) return realpath(candidate)
  }
  return undefined
}

async function installDependenciesWithPnpm({ dependencies, repositoryRoot, storageRoot }) {
  const entries = Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right))
  const digest = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  const dependenciesRoot = join(storageRoot, 'dependencies')
  const installRoot = join(dependenciesRoot, digest.slice(0, 24))
  const nodeModules = join(installRoot, 'node_modules')
  await mkdir(dependenciesRoot, { recursive: true })
  if (await pathMetadata(installRoot) !== undefined) return nodeModules

  const stagingRoot = await mkdtemp(join(storageRoot, '.dependencies-'))
  try {
    await writeFile(join(stagingRoot, 'package.json'), `${JSON.stringify({
      dependencies: Object.fromEntries(entries),
      name: 'dsh-development-package-dependencies',
      private: true,
      version: '0.0.0',
    }, undefined, 2)}\n`)
    console.log(`development package override: installing missing dependencies ${entries.map(([name]) => name).join(', ')}`)
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const result = spawnSync(
      command,
      ['--dir', stagingRoot, 'install', '--prod', '--ignore-workspace', '--no-lockfile', '--ignore-scripts'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
      throw new Error(`pnpm could not install development package dependencies: ${detail}`)
    }
    await rename(stagingRoot, installRoot)
    return nodeModules
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}

async function createDependencyOverlay({
  cliNodeModules,
  dependencyRoot,
  installDependencies,
  manifest,
  repositoryRoot,
  storageName,
  storageRoot,
}) {
  const regular = { ...manifest.dependencies }
  const optionalDependencies = manifest.optionalDependencies ?? {}
  for (const name of Object.keys(optionalDependencies)) delete regular[name]
  const optionalPeers = new Set(
    Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata?.optional === true)
      .map(([name]) => name),
  )
  const peerDependencies = manifest.peerDependencies ?? {}
  const declaredNames = new Set([
    ...Object.keys(regular),
    ...Object.keys(optionalDependencies),
    ...Object.keys(peerDependencies),
  ])
  for (const name of declaredNames) {
    validatePackageName(name, `${manifest.name} package.json`)
  }

  const dependencyTargets = new Map()
  const missingRegular = {}
  for (const [name, version] of Object.entries(regular)) {
    const target = await dependencyTarget([dependencyRoot, cliNodeModules], name)
    if (target === undefined) missingRegular[name] = version
    else dependencyTargets.set(name, target)
  }
  if (Object.keys(missingRegular).length > 0) {
    const installed = await installDependencies({
      dependencies: missingRegular,
      repositoryRoot,
      storageRoot,
    })
    for (const name of Object.keys(missingRegular)) {
      const target = await dependencyTarget([installed], name)
      if (target === undefined) {
        throw new Error(`development dependency installation did not provide ${JSON.stringify(name)}`)
      }
      dependencyTargets.set(name, target)
    }
  }
  for (const name of Object.keys(optionalDependencies)) {
    const target = await dependencyTarget([dependencyRoot, cliNodeModules], name)
    if (target !== undefined) dependencyTargets.set(name, target)
  }
  for (const name of Object.keys(peerDependencies)) {
    if (dependencyTargets.has(name)) continue
    const target = await dependencyTarget([dependencyRoot, cliNodeModules], name)
    if (target === undefined && !optionalPeers.has(name)) {
      throw new Error(`packed package peer dependency ${JSON.stringify(name)} is not installed in the public package closure or CLI workspace`)
    }
    if (target !== undefined) dependencyTargets.set(name, target)
  }

  const dependencies = [...dependencyTargets]
    .map(([name, target]) => ({ name, target }))
    .sort((left, right) => left.name.localeCompare(right.name))

  const digest = createHash('sha256').update(JSON.stringify(dependencies)).digest('hex')
  const resolversRoot = join(storageRoot, 'resolvers')
  const resolverRoot = join(resolversRoot, `${storageName}-${digest.slice(0, 16)}`)
  await mkdir(resolversRoot, { recursive: true })
  if (await pathMetadata(resolverRoot) !== undefined) return resolverRoot

  const stagingRoot = await mkdtemp(join(storageRoot, '.resolver-'))
  try {
    for (const dependency of dependencies) {
      const destination = join(stagingRoot, ...dependency.name.split('/'))
      await mkdir(dirname(destination), { recursive: true })
      await symlink(dependency.target, destination, process.platform === 'win32' ? 'junction' : 'dir')
    }
    await rename(stagingRoot, resolverRoot)
    return resolverRoot
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}

async function replaceWithDirectoryLink(target, source) {
  const targetParent = dirname(target)
  await mkdir(targetParent, { recursive: true })
  const nonce = `${process.pid}-${randomUUID()}`
  const temporary = join(targetParent, `.${basename(target)}.dev-override-${nonce}`)
  const backup = join(targetParent, `.${basename(target)}.dev-override-backup-${nonce}`)
  await symlink(source, temporary, process.platform === 'win32' ? 'junction' : 'dir')

  let movedExisting = false
  try {
    try {
      await rename(temporary, target)
      return
    } catch (error) {
      if (!['EEXIST', 'EISDIR', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error
    }

    if (await pathMetadata(target) === undefined) {
      await rename(temporary, target)
      return
    }
    await rename(target, backup)
    movedExisting = true
    try {
      await rename(temporary, target)
    } catch (error) {
      await rename(backup, target)
      movedExisting = false
      throw error
    }
    await rm(backup, { force: true, recursive: true })
    movedExisting = false
  } finally {
    await rm(temporary, { force: true, recursive: true })
    if (movedExisting) await rm(backup, { force: true, recursive: true })
  }
}

/**
 * Resolve and validate the machine-local packed package configuration.
 * Missing configuration is represented by an empty list.
 *
 * @param {object} options - Repository and optional configuration path.
 * @param {string} options.repositoryRoot - Absolute repository root.
 * @param {string} [options.configPath] - JSON map of package names to archive paths.
 * @returns {Promise<Array<{name: string, archivePath: string}>>} Validated archives in package-name order.
 */
export async function resolveDevelopmentPackageOverrideArchives({
  repositoryRoot,
  configPath = join(repositoryRoot, DEVELOPMENT_PACKAGE_OVERRIDE_CONFIG),
}) {
  if (!isAbsolute(repositoryRoot)) throw new Error('development package override repositoryRoot must be absolute')
  const config = await readConfig(configPath)
  if (config === undefined) return []

  const archives = []
  for (const [name, configuredPath] of Object.entries(config).sort(([left], [right]) => left.localeCompare(right))) {
    validatePackageName(name, configPath)
    if (typeof configuredPath !== 'string' || configuredPath.trim() === '') {
      throw new Error(`${configPath}: override for ${JSON.stringify(name)} must be a non-empty archive path`)
    }
    const archivePath = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(dirname(configPath), configuredPath)
    if (!ARCHIVE_SUFFIXES.some(suffix => archivePath.endsWith(suffix))) {
      throw new Error(`${configPath}: override for ${JSON.stringify(name)} must reference a .tgz or .tar.gz archive`)
    }
    const metadata = await pathMetadata(archivePath)
    if (metadata === undefined || !metadata.isFile()) {
      throw new Error(`${configPath}: override archive for ${JSON.stringify(name)} is not a regular file: ${archivePath}`)
    }
    archives.push({ archivePath, name })
  }
  return archives
}

/**
 * Apply machine-local packed npm package overrides to the CLI runtime resolver.
 * Missing configuration is a no-op. Invalid configuration or package metadata
 * rejects before Electron starts.
 *
 * @param {object} options - Repository and optional test fixture paths.
 * @param {string} options.repositoryRoot - Absolute repository root.
 * @param {string} [options.configPath] - JSON map of package names to archive paths.
 * @param {string} [options.cliManifestPath] - CLI package manifest that declares override targets.
 * @param {string} [options.cliNodeModules] - Runtime package resolver directory.
 * @param {string} [options.storageRoot] - Ignored content-addressed extraction directory.
 * @param {(input: {repositoryRoot: string, cliPackageName: string, packageName: string}) => string} [options.resolveInstalledPackage] - Installed package lookup.
 * @param {(input: {dependencies: Record<string, string>, repositoryRoot: string, storageRoot: string}) => Promise<string>} [options.installDependencies] - Missing regular dependency installer.
 * @returns {Promise<Array<{name: string, archivePath: string, archiveSha256: string, packageRoot: string, version: string}>>} Applied overrides.
 */
export async function applyDevelopmentPackageOverrides({
  repositoryRoot,
  configPath = join(repositoryRoot, DEVELOPMENT_PACKAGE_OVERRIDE_CONFIG),
  cliManifestPath = join(repositoryRoot, 'apps', 'cli', 'package.json'),
  cliNodeModules = join(repositoryRoot, 'apps', 'cli', 'node_modules'),
  storageRoot = join(repositoryRoot, '.dev-package-overrides'),
  resolveInstalledPackage = resolveInstalledPackageWithPnpm,
  installDependencies = installDependenciesWithPnpm,
}) {
  const archives = await resolveDevelopmentPackageOverrideArchives({ repositoryRoot, configPath })
  if (archives.length === 0) return []

  const cli = await readCliDependencies(cliManifestPath)
  const prepared = []
  for (const { archivePath, name } of archives) {
    if (!cli.dependencies.has(name)) {
      throw new Error(`${configPath}: ${JSON.stringify(name)} is not a declared CLI dependency`)
    }
    const installedPackagePath = resolveInstalledPackage({
      cliPackageName: cli.packageName,
      packageName: name,
      repositoryRoot,
    })
    const dependencyRoot = await installedDependencyRoot({
      cliNodeModules,
      installedPackagePath,
      name,
    })
    const extracted = await extractPackage({
      archivePath,
      expectedName: name,
      storageRoot,
    })
    const resolverRoot = await createDependencyOverlay({
      cliNodeModules,
      dependencyRoot,
      installDependencies,
      manifest: extracted.manifest,
      repositoryRoot,
      storageName: extracted.storageName,
      storageRoot,
    })
    await replaceWithDirectoryLink(join(extracted.packageRoot, 'node_modules'), resolverRoot)
    prepared.push({
      archivePath,
      archiveSha256: extracted.archiveSha256,
      name,
      packageRoot: extracted.packageRoot,
      version: extracted.manifest.version,
    })
  }

  for (const override of prepared) {
    const target = join(cliNodeModules, ...override.name.split('/'))
    await replaceWithDirectoryLink(target, override.packageRoot)
    console.log(`development package override: ${override.name} <- ${override.archivePath}`)
  }
  return prepared
}
