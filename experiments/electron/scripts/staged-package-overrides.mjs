/** Apply explicit local package archives inside a newly deployed runtime. */

import { join } from 'node:path'
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
