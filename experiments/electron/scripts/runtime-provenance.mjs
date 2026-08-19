/** Record and verify the inputs that determine a packaged CLI runtime. */

import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export const RUNTIME_PROVENANCE_FILE = '.dsh-runtime-provenance.json'

const SHA256 = /^[a-f0-9]{64}$/u

async function digestEntry(hash, root, path) {
  const metadata = await lstat(path)
  const name = relative(root, path).split(sep).join('/')
  if (metadata.isDirectory()) {
    hash.update(`directory\0${name}\0`)
    for (const entry of (await readdir(path)).sort()) await digestEntry(hash, root, join(path, entry))
  } else if (metadata.isFile()) {
    hash.update(`file\0${name}\0${metadata.mode & 0o111}\0`)
    hash.update(await readFile(path))
    hash.update('\0')
  } else if (metadata.isSymbolicLink()) {
    hash.update(`symlink\0${name}\0${await readlink(path)}\0`)
  } else {
    throw new Error(`runtime provenance cannot digest unsupported file type: ${path}`)
  }
}

/**
 * Calculate a stable digest for one installed package directory.
 * @param {string} root - Package directory.
 * @returns {Promise<string>} Lowercase SHA-256 digest.
 */
export async function digestDirectory(root) {
  const metadata = await lstat(root)
  if (!metadata.isDirectory()) throw new Error(`runtime provenance root is not a directory: ${root}`)
  const hash = createHash('sha256')
  for (const entry of (await readdir(root)).sort()) await digestEntry(hash, root, join(root, entry))
  return hash.digest('hex')
}

/**
 * Calculate the SHA-256 digest of a configured packed archive.
 * @param {string} path - Archive path.
 * @returns {Promise<string>} Lowercase SHA-256 digest.
 */
export async function digestFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/**
 * Write the target and local package inputs into the staged runtime.
 * @param {object} options - Runtime provenance fields.
 * @param {string} options.root - Staged runtime root.
 * @param {'darwin' | 'win32'} options.platform - Target platform.
 * @param {'arm64' | 'x64'} options.arch - Target architecture.
 * @param {Array<{name: string, version: string, archiveSha256: string, installedPackageSha256: string}>} options.localOverrides - Applied local packages.
 * @returns {Promise<object>} Written provenance object.
 */
export async function writeRuntimeProvenance({ root, platform, arch, localOverrides }) {
  const provenance = {
    schemaVersion: 1,
    target: { arch, platform },
    localOverrides: [...localOverrides].sort((left, right) => left.name.localeCompare(right.name)),
  }
  await writeFile(join(root, RUNTIME_PROVENANCE_FILE), `${JSON.stringify(provenance, undefined, 2)}\n`)
  return provenance
}

function assertString(value, description) {
  if (typeof value !== 'string' || value === '') throw new Error(`invalid runtime provenance ${description}`)
  return value
}

/**
 * Read and validate provenance from an extracted staged runtime.
 * @param {string} root - Extracted runtime root.
 * @returns {Promise<{schemaVersion: 1, target: {platform: string, arch: string}, localOverrides: Array<{name: string, version: string, archiveSha256: string, installedPackageSha256: string}>}>} Validated provenance.
 */
export async function readRuntimeProvenance(root) {
  const path = join(root, RUNTIME_PROVENANCE_FILE)
  let provenance
  try {
    provenance = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path}: cannot read runtime provenance`, { cause: error })
  }
  if (provenance?.schemaVersion !== 1 || provenance.target === null || typeof provenance.target !== 'object') {
    throw new Error(`${path}: unsupported runtime provenance schema`)
  }
  const platform = assertString(provenance.target.platform, 'target platform')
  const arch = assertString(provenance.target.arch, 'target architecture')
  if (!Array.isArray(provenance.localOverrides)) throw new Error(`${path}: invalid runtime provenance local overrides`)
  const localOverrides = provenance.localOverrides.map((override, index) => {
    if (override === null || typeof override !== 'object') throw new Error(`${path}: invalid local override ${index}`)
    const archiveSha256 = assertString(override.archiveSha256, `local override ${index} archive digest`)
    const installedPackageSha256 = assertString(override.installedPackageSha256, `local override ${index} package digest`)
    if (!SHA256.test(archiveSha256) || !SHA256.test(installedPackageSha256)) {
      throw new Error(`${path}: invalid SHA-256 digest for local override ${index}`)
    }
    return {
      archiveSha256,
      installedPackageSha256,
      name: assertString(override.name, `local override ${index} name`),
      version: assertString(override.version, `local override ${index} version`),
    }
  })
  return { schemaVersion: 1, target: { arch, platform }, localOverrides }
}
