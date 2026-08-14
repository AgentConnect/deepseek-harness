/** Remove development-only and non-target-platform files from a staged runtime. */

import { lstat, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEVELOPMENT_DIRECTORIES = new Set(['__tests__', 'examples', 'test', 'tests'])
const DEVELOPMENT_FILE_PATTERNS = [/\.d\.(?:c|m)?ts$/u, /\.map$/u, /\.pdb$/u, /\.tsbuildinfo$/u]

async function removeDevelopmentArtifacts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (DEVELOPMENT_DIRECTORIES.has(entry.name)) await rm(path, { recursive: true, force: true })
      else await removeDevelopmentArtifacts(path)
    } else if (entry.isFile() && DEVELOPMENT_FILE_PATTERNS.some(pattern => pattern.test(entry.name))) {
      await rm(path, { force: true })
    }
  }
}

async function pruneNodePty(nodeModules, platform, arch) {
  const nodePty = join(nodeModules, 'node-pty')
  const prebuilds = join(nodePty, 'prebuilds')
  const targetPrebuild = `${platform}-${arch}`
  for (const entry of await readdir(prebuilds, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== targetPrebuild) {
      await rm(join(prebuilds, entry.name), { recursive: true, force: true })
    }
  }
  for (const name of ['binding.gyp', 'deps', 'scripts', 'src', 'third_party', 'typings']) {
    await rm(join(nodePty, name), { recursive: true, force: true })
  }
}

export async function pruneRuntime(runtimeRoot, platform, arch) {
  const metadata = await lstat(runtimeRoot)
  if (!metadata.isDirectory()) throw new Error(`prune-runtime: runtime root is not a directory: ${runtimeRoot}`)
  const nodeModules = join(runtimeRoot, 'node_modules')
  await pruneNodePty(nodeModules, platform, arch)
  await removeDevelopmentArtifacts(nodeModules)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runtimeRoot, platform, arch] = process.argv.slice(2)
  if (runtimeRoot === undefined || platform === undefined || arch === undefined) {
    throw new Error('usage: prune-runtime.mjs <runtime-root> <platform> <arch>')
  }
  await pruneRuntime(runtimeRoot, platform, arch)
  process.stdout.write(`prune-runtime: pruned ${basename(runtimeRoot)} for ${platform}-${arch}\n`)
}
