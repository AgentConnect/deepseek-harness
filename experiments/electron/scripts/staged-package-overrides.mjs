/** Apply explicit local package archives inside a newly deployed runtime. */

import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { applyDevelopmentPackageOverrides } from './dev-package-overrides.mjs'

/**
 * Replace declared packages in a staged, lockfile-derived runtime.
 * Missing regular dependencies reject instead of changing the staged closure.
 *
 * @param {object} options - Repository and staged runtime paths.
 * @param {string} options.repositoryRoot - Absolute repository root.
 * @param {string} options.runtimeRoot - Newly deployed runtime root.
 * @returns {ReturnType<typeof applyDevelopmentPackageOverrides>} Applied package metadata.
 */
export async function applyStagedPackageOverrides({ repositoryRoot, runtimeRoot }) {
  const cliNodeModules = join(runtimeRoot, 'node_modules')
  const applied = await applyDevelopmentPackageOverrides({
    repositoryRoot,
    cliManifestPath: join(cliNodeModules, '@deepseek-ai', 'dsh', 'package.json'),
    cliNodeModules,
    storageRoot: join(repositoryRoot, '.dev-package-overrides', 'stage-cache'),
    resolveInstalledPackage: ({ packageName }) => join(cliNodeModules, ...packageName.split('/')),
    installDependencies: async ({ dependencies }) => {
      throw new Error(`staged package override dependencies are absent from the locked runtime: ${Object.keys(dependencies).sort().join(', ')}`)
    },
  })
  if (applied.length === 0) {
    throw new Error('local runtime packaging requires at least one entry in .dev-package-overrides.json')
  }
  return applied
}

/**
 * Copy each configured package into its resolver path without carrying the
 * temporary dependency overlay into the packaged runtime.
 *
 * @param {object} options - Applied package metadata and staged runtime root.
 * @param {Awaited<ReturnType<typeof applyDevelopmentPackageOverrides>>} options.applied - Validated local packages.
 * @param {string} options.runtimeRoot - Newly deployed runtime root.
 * @returns {Promise<void>} Resolves after every local package is materialized.
 */
export async function materializeStagedPackageOverrides({ applied, runtimeRoot }) {
  const ordered = [...applied].sort((left, right) => {
    const depth = left.packagePath.split(sep).length - right.packagePath.split(sep).length
    return depth || left.name.localeCompare(right.name)
  })
  for (const override of ordered) {
    const relativePath = override.packagePath.slice(runtimeRoot.length + 1)
    if (!override.packagePath.startsWith(`${runtimeRoot}${sep}`) || relativePath === '') {
      throw new Error(`staged package override path is outside the runtime: ${override.packagePath}`)
    }
    const nestedNodeModules = join(override.packageRoot, 'node_modules')
    await rm(override.packagePath, { force: true, recursive: true })
    await mkdir(dirname(override.packagePath), { recursive: true })
    await cp(override.packageRoot, override.packagePath, {
      recursive: true,
      dereference: false,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}
