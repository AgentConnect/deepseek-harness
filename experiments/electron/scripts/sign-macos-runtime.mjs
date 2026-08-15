/** Sign every Mach-O payload before the staged runtime is compressed. */

import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const exec = promisify(execFile)
const MACH_O_MAGICS = new Set([
  0xfeedface,
  0xcefaedfe,
  0xfeedfacf,
  0xcffaedfe,
  0xcafebabe,
  0xbebafeca,
  0xcafebabf,
  0xbfbafeca,
])

/**
 * Test whether a regular file starts with a Mach-O or universal-binary header.
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function isMachOBinary(path) {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return bytesRead === header.length && MACH_O_MAGICS.has(header.readUInt32BE(0))
  } finally {
    await handle.close()
  }
}

/**
 * Find regular Mach-O files in stable path order without following symlinks.
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function findMachOBinaries(directory) {
  const binaries = []
  for (const entry of (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      binaries.push(...await findMachOBinaries(path))
    } else if (entry.isFile() && await isMachOBinary(path)) {
      binaries.push(path)
    }
  }
  return binaries
}

/**
 * Sign staged native runtime files so Apple can validate them after unpacking the archive.
 * @param {{
 *   root: string,
 *   environment?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   run?: (file: string, args: string[]) => Promise<unknown>,
 * }} options
 * @returns {Promise<string[]>}
 */
export async function signMacRuntime({
  root,
  environment = process.env,
  platform = process.platform,
  run = exec,
}) {
  if (platform !== 'darwin') return []

  const identity = environment.DSH_MACOS_SIGN_IDENTITY?.trim() ?? ''
  const requireSigning = environment.DSH_REQUIRE_MACOS_SIGNING?.trim() ?? ''
  if (identity === '') {
    if (requireSigning === '1') {
      throw new Error('macOS runtime signing is required but DSH_MACOS_SIGN_IDENTITY is missing')
    }
    return []
  }
  if (!identity.startsWith('Developer ID Application:')) {
    throw new Error('DSH_MACOS_SIGN_IDENTITY must name a Developer ID Application identity')
  }

  const keychain = environment.DSH_MACOS_KEYCHAIN?.trim()
  const binaries = await findMachOBinaries(root)
  for (const binary of binaries) {
    const args = [
      '--force',
      '--timestamp',
      '--options', 'runtime',
      '--sign', identity,
      ...(keychain ? ['--keychain', keychain] : []),
      binary,
    ]
    await run('codesign', args)
  }
  return binaries
}
