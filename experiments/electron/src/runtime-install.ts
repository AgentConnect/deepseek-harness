/** Materialize the packaged DSH runtime from one installer-safe archive. */

import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extract as extractTar } from 'tar'

const ARCHIVE_NAME = '.forge-runtime.tar.gz'
const READY_MARKER = '.dsh-runtime-ready.json'
const CLI_RELATIVE_PATH = ['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'] as const
const SAFE_ID_SEGMENT = /^[a-zA-Z0-9._-]+$/u

export interface PackagedRuntimeOptions {
  resourcesPath: string
  userDataPath: string
  version: string
  platform: NodeJS.Platform
  arch: string
}

interface RuntimeMarker {
  archiveSize: number
}

function runtimeId(options: PackagedRuntimeOptions): string {
  const segments = [options.version, options.platform, options.arch]
  if (segments.some(segment => !SAFE_ID_SEGMENT.test(segment))) {
    throw new Error(`dsh Electron: invalid packaged runtime identity: ${JSON.stringify(segments)}`)
  }
  return segments.join('-')
}

async function isReady(directory: string, archiveSize: number): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(directory, READY_MARKER), 'utf8')) as RuntimeMarker
    if (marker.archiveSize !== archiveSize) return false
    return (await lstat(join(directory, ...CLI_RELATIVE_PATH))).isFile()
  } catch {
    return false
  }
}

/**
 * Extract the immutable packaged runtime once and atomically publish it under Electron userData.
 * Squirrel therefore sees one archive instead of NuGet-incompatible third-party long paths.
 */
export async function ensurePackagedRuntime(options: PackagedRuntimeOptions): Promise<string> {
  const archive = join(options.resourcesPath, ARCHIVE_NAME)
  const archiveSize = (await stat(archive)).size
  const parent = join(options.userDataPath, 'runtime')
  const destination = join(parent, runtimeId(options))
  if (await isReady(destination, archiveSize)) return destination

  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, '.staging-'))
  try {
    await extractTar({ cwd: staging, file: archive, preserveOwner: false, strict: true })
    const cli = join(staging, ...CLI_RELATIVE_PATH)
    await access(cli)
    if (!(await lstat(cli)).isFile()) throw new Error('dsh Electron: packaged runtime CLI is not a regular file')
    await writeFile(join(staging, READY_MARKER), `${JSON.stringify({ archiveSize } satisfies RuntimeMarker)}\n`, 'utf8')
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
    return destination
  } catch (error: unknown) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
