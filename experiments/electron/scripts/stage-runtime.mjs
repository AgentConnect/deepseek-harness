/** Stage a self-contained DSH CLI closure and rebuild native modules for Electron. */

import { rebuild } from '@electron/rebuild'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { create as createTar } from 'tar'
import { pruneRuntime } from './prune-runtime.mjs'
import { signMacRuntime } from './sign-macos-runtime.mjs'

const exec = promisify(execFile)
const EXEC_MAX_BUFFER = 16 * 1024 * 1024
const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const target = join(appRoot, '.forge-runtime.tar.gz')
const npmExecPath = process.env.npm_execpath
if (npmExecPath === undefined) throw new Error('stage-runtime: npm_execpath is unavailable; run this script through pnpm')
const stagingRoot = await mkdtemp(join(tmpdir(), 'dsh-electron-runtime-'))
const stagedTarget = join(stagingRoot, 'runtime')
const deploySourceNodeModules = join(repositoryRoot, 'experiments', 'electron-runtime', 'node_modules')

async function restoreDirectWorkspaceDependencies(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const source = join(deploySourceNodeModules, dependency)
    if (!existsSync(source)) throw new Error(`stage-runtime: deploy source dependency is missing: ${dependency}`)
    const resolvedSource = await realpath(source)
    const destination = join(directory, 'node_modules', dependency)
    const nestedNodeModules = join(resolvedSource, 'node_modules')
    await rm(destination, { recursive: true, force: true })
    await mkdir(dirname(destination), { recursive: true })
    await cp(resolvedSource, destination, {
      recursive: true,
      dereference: false,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}

async function findSymlink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializeStagedLinks(directory) {
  const nodeModules = join(directory, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const source = await realpath(remaining)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(remaining, { recursive: true, force: true })
    await cp(source, remaining, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = await findSymlink(nodeModules)
  }
}

try {
  await exec(process.execPath, [
    npmExecPath, '--dir', repositoryRoot, '--filter', 'deepseek-harness-electron-runtime',
    'deploy', '--prod', '--legacy', '--config.node-linker=hoisted',
    '--config.auto-install-peers=false', '--config.link-workspace-packages=true',
    '--config.block-exotic-subdeps=false', stagedTarget,
  ], { cwd: repositoryRoot, env: { ...process.env, CI: 'true' }, maxBuffer: EXEC_MAX_BUFFER })
  await restoreDirectWorkspaceDependencies(stagedTarget)
  await materializeStagedLinks(stagedTarget)

  const electronManifest = JSON.parse(await readFile(fileURLToPath(import.meta.resolve('electron/package.json')), 'utf8'))
  if (typeof electronManifest.version !== 'string') throw new Error('stage-runtime: electron package has no version')
  await rebuild({ buildPath: stagedTarget, electronVersion: electronManifest.version, arch: process.arch, force: true })

  const runtimeRequire = createRequire(join(stagedTarget, 'package.json'))
  const cliManifest = runtimeRequire.resolve('@deepseek-ai/dsh/package.json')
  const cliRequire = createRequire(cliManifest)
  const baseManifest = cliRequire.resolve('@deepseek-ai/dsh-base/package.json')
  const baseRequire = createRequire(baseManifest)
  const subprocessManifest = baseRequire.resolve('@deepseek-ai/dsh-subprocess-local/package.json')
  await exec(process.execPath, [join(dirname(subprocessManifest), 'scripts', 'ensure-spawn-helper.mjs')], {
    cwd: stagedTarget,
    maxBuffer: EXEC_MAX_BUFFER,
  })
  await pruneRuntime(stagedTarget, process.platform, process.arch)
  await signMacRuntime({ root: stagedTarget })
  await rm(target, { force: true })
  await createTar({ cwd: stagedTarget, file: target, gzip: true, portable: false }, ['.'])
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
  await exec(process.execPath, [npmExecPath, '--dir', repositoryRoot, 'install', '--frozen-lockfile'], {
    cwd: repositoryRoot,
    env: { ...process.env, CI: 'true' },
    maxBuffer: EXEC_MAX_BUFFER,
  })
}
